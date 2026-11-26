import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SupportChatWidget } from '../SupportChatWidget';
import { apiClient } from '@/lib/api';
import { getAuthToken } from '@/lib/auth-token';

const mockPathname = vi.fn(() => '/en/dashboard/farmer');

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/auth-token', () => ({
  getAuthToken: vi.fn(() => 'mock-jwt'),
}));

describe('SupportChatWidget (#1374)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    delete window.$crisp;
    delete window.CRISP_WEBSITE_ID;
    delete window.Intercom;
    delete window.intercomSettings;
    mockPathname.mockReturnValue('/en/dashboard/farmer');
    vi.mocked(getAuthToken).mockReturnValue('mock-jwt');

    vi.spyOn(apiClient, 'getCurrentUser').mockReturnValue({
      id: 'u1',
      email: 'ama@agri-fi.test',
      name: 'Ama Mensah',
      role: 'farmer',
      kycStatus: 'verified',
    });
    vi.spyOn(apiClient, 'refreshCurrentUser').mockResolvedValue({
      id: 'u1',
      email: 'ama@agri-fi.test',
      name: 'Ama Mensah',
      role: 'farmer',
      kycStatus: 'verified',
    });
    vi.spyOn(apiClient, 'getFarmerDeals').mockResolvedValue([
      {
        id: 'deal-101',
        title: 'Ghana Cocoa Harvest',
        commodity: 'Cocoa',
        quantity: 1000,
        quantity_unit: 'kg',
        total_value: 50000,
        funded_amount: 25000,
        total_invested: 25000,
        token_count: 500,
        tokens_remaining: 250,
        token_symbol: 'COCOA-101',
        status: 'open',
        delivery_date: '2026-12-30',
        created_at: '2026-11-01',
      },
      {
        id: 'deal-102',
        commodity: 'Maize',
        quantity: 500,
        quantity_unit: 'kg',
        total_value: 20000,
        funded_amount: 20000,
        total_invested: 20000,
        token_count: 200,
        tokens_remaining: 0,
        token_symbol: 'MAIZE-102',
        status: 'completed',
        delivery_date: '2026-10-01',
        created_at: '2026-08-01',
      },
    ]);
  });

  it('hides widget completely on /auth/* pages', () => {
    mockPathname.mockReturnValue('/auth/login');
    const { container } = render(<SupportChatWidget enabled={true} />);
    expect(container.firstChild).toBeNull();

    mockPathname.mockReturnValue('/en/auth/register');
    const { container: localeContainer } = render(
      <SupportChatWidget enabled={true} />,
    );
    expect(localeContainer.firstChild).toBeNull();
  });

  it('shows "Support unavailable" notice and skips SDK when disabled', () => {
    render(<SupportChatWidget enabled={false} provider="crisp" websiteId="site-1" />);
    expect(screen.getByTestId('support-unavailable-notice')).toHaveTextContent(
      'Support unavailable',
    );
    expect(window.$crisp).toBeUndefined();
    expect(
      document.querySelector('script[data-support-sdk="crisp"]'),
    ).toBeNull();
  });

  it('shows GDPR notice before first chat session, pre-fills context, and attaches deal metadata', async () => {
    render(
      <SupportChatWidget enabled={true} provider="crisp" websiteId="site-abc" />,
    );

    fireEvent.click(screen.getByRole('button', { name: /open live support chat/i }));

    await waitFor(() => {
      expect(screen.getByTestId('support-user-context')).toHaveTextContent(
        'Ama Mensah',
      );
    });
    expect(screen.getByTestId('support-user-context')).toHaveTextContent(
      'farmer / verified',
    );
    expect(screen.getByTestId('support-user-context')).toHaveTextContent('1');

    // GDPR notice displayed before first chat session; SDK not initialized yet
    expect(screen.getByTestId('support-gdpr-notice')).toBeInTheDocument();
    expect(window.$crisp).toBeUndefined();

    // Accept GDPR
    fireEvent.click(screen.getByRole('button', { name: /accept & start chat/i }));

    await waitFor(() => {
      expect(window.$crisp).toBeDefined();
    });

    expect(window.$crisp).toEqual(
      expect.arrayContaining([
        ['set', 'user:nickname', ['Ama Mensah']],
        [
          'set',
          'session:data',
          [
            [
              ['user_name', 'Ama Mensah'],
              ['role', 'farmer'],
              ['kyc_status', 'verified'],
              ['active_deal_count', '1'],
            ],
          ],
        ],
      ]),
    );

    // Open deal picker and attach a deal
    fireEvent.click(screen.getByRole('button', { name: /attach deal/i }));
    expect(screen.getByTestId('support-deal-picker')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Ghana Cocoa Harvest'));

    expect(screen.getByTestId('attached-deal-badge')).toHaveTextContent(
      'deal-101',
    );
    expect(window.$crisp).toEqual(
      expect.arrayContaining([
        [
          'set',
          'session:data',
          [
            expect.arrayContaining([
              ['attached_deal_id', 'deal-101'],
              ['attached_deal_commodity', 'Cocoa'],
            ]),
          ],
        ],
      ]),
    );
  });

  it('supports Intercom provider when SUPPORT_CHAT_PROVIDER=intercom', async () => {
    localStorage.setItem('agrifi_support_gdpr_accepted', 'true');
    window.Intercom = vi.fn();

    render(
      <SupportChatWidget
        enabled={true}
        provider="intercom"
        websiteId="app-xyz"
      />,
    );

    await waitFor(() => {
      expect(window.Intercom).toHaveBeenCalledWith(
        'update',
        expect.objectContaining({
          name: 'Ama Mensah',
          role: 'farmer',
          kyc_status: 'verified',
          active_deal_count: 1,
        }),
      );
    });
  });
});
