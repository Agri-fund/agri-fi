/**
 * Issue #112 security fix — OrderBook component tests.
 *
 * Verifies that:
 *  1. An unauthenticated user sees the "Connect wallet" prompt and
 *     the buy-orders fetch is NEVER initiated.
 *  2. An authenticated user triggers the fetch and sees the order table.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { OrderBook } from '../OrderBook';

// ── helpers ────────────────────────────────────────────────────────────────

/** Seed localStorage with a fake JWT so the component treats the user as logged in. */
const setAuthToken = (token: string | null) => {
  if (token) {
    localStorage.setItem('auth_token', token);
  } else {
    localStorage.removeItem('auth_token');
  }
};

const TOKEN_CODE = 'AGRI';
const TOKEN_ISSUER = 'GISSUER1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// ── setup / teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  jest.resetAllMocks();
  localStorage.clear();
  // Reset global fetch mock
  global.fetch = jest.fn();
});

// ── tests ──────────────────────────────────────────────────────────────────

describe('OrderBook – unauthenticated user', () => {
  it('shows the login prompt and does NOT call fetch', () => {
    setAuthToken(null); // no token in localStorage

    render(
      <OrderBook tradeTokenCode={TOKEN_CODE} tradeTokenIssuer={TOKEN_ISSUER} />,
    );

    // Login prompt must be visible
    expect(
      screen.getByText('Connect wallet to view order book'),
    ).toBeInTheDocument();

    // The buy-orders URL must never be requested
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does NOT render the order-book table when unauthenticated', () => {
    setAuthToken(null);

    render(
      <OrderBook tradeTokenCode={TOKEN_CODE} tradeTokenIssuer={TOKEN_ISSUER} />,
    );

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('does NOT include the token issuer in any network request', () => {
    setAuthToken(null);

    render(
      <OrderBook tradeTokenCode={TOKEN_CODE} tradeTokenIssuer={TOKEN_ISSUER} />,
    );

    // fetch should not have been called at all, so the issuer was never sent
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('OrderBook – authenticated user', () => {
  const FAKE_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.test.sig';

  const MOCK_OFFERS = [
    { offerId: '1', buyer: 'GBUYERAAAA', amount: '50', price: '1.10' },
    { offerId: '2', buyer: 'GBUYERBBBB', amount: '25', price: '1.05' },
  ];

  beforeEach(() => {
    setAuthToken(FAKE_TOKEN);

    // Successful fetch returning two offers
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => MOCK_OFFERS,
    });
  });

  it('calls the buy-orders endpoint with an Authorization header', async () => {
    render(
      <OrderBook tradeTokenCode={TOKEN_CODE} tradeTokenIssuer={TOKEN_ISSUER} />,
    );

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    const [url, options] = (global.fetch as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];

    expect(url).toContain('/api/investments/buy-orders/');
    expect((options.headers as Record<string, string>)['Authorization']).toBe(
      `Bearer ${FAKE_TOKEN}`,
    );
  });

  it('renders fetched offers in the table', async () => {
    render(
      <OrderBook tradeTokenCode={TOKEN_CODE} tradeTokenIssuer={TOKEN_ISSUER} />,
    );

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());

    // Both offers should appear as rows
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
  });

  it('shows an error message when the API returns a non-OK response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });

    render(
      <OrderBook tradeTokenCode={TOKEN_CODE} tradeTokenIssuer={TOKEN_ISSUER} />,
    );

    await waitFor(() =>
      expect(screen.getByText('Failed to load offers')).toBeInTheDocument(),
    );

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
