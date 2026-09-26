import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InvestmentModal } from '../InvestmentModal';
import { ToastProvider } from '../../ui/ToastProvider';
import { useWallet } from '../../../hooks/useWallet';
import type { Deal } from '@/lib/api';

vi.mock('../../../hooks/useWallet', () => ({
  useWallet: vi.fn(),
}));

const mockUseWallet = useWallet as unknown as ReturnType<typeof vi.fn>;

const deal = {
  id: 'deal-1',
  commodity: 'Coffee',
  total_value: 10000,
  token_count: 100,
  tokens_remaining: 50,
  delivery_date: '2027-01-01',
  status: 'open',
} as unknown as Deal;

function walletState(overrides: Record<string, unknown> = {}) {
  return {
    isConnected: false,
    publicKey: null,
    signTransaction: vi.fn(),
    connect: vi.fn().mockResolvedValue('GABC'),
    availableWallets: ['freighter', 'albedo'],
    configuredNetwork: 'testnet',
    detectedNetwork: null,
    ...overrides,
  };
}

function renderModal(onClose = vi.fn()) {
  render(
    <ToastProvider>
      <InvestmentModal deal={deal} onClose={onClose} />
    </ToastProvider>,
  );
  return onClose;
}

describe('InvestmentModal accessibility', () => {
  beforeEach(() => {
    mockUseWallet.mockReset();
  });

  it('is a labelled modal dialog', () => {
    mockUseWallet.mockReturnValue(walletState({ isConnected: true, publicKey: 'GABC' }));
    renderModal();

    const dialog = screen.getByRole('dialog', { name: 'Invest in Coffee' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Close investment dialog' })).toBeInTheDocument();
  });

  it('puts initial focus on the token amount when a wallet is connected', () => {
    mockUseWallet.mockReturnValue(walletState({ isConnected: true, publicKey: 'GABC' }));
    renderModal();

    expect(screen.getByLabelText('Number of Tokens')).toHaveFocus();
  });

  it('closes on Escape', async () => {
    mockUseWallet.mockReturnValue(walletState({ isConnected: true, publicKey: 'GABC' }));
    const user = userEvent.setup();
    const onClose = renderModal();

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens the wallet picker from the keyboard and Escape closes only the picker', async () => {
    mockUseWallet.mockReturnValue(walletState());
    const user = userEvent.setup();
    const onClose = renderModal();

    const connectButton = screen.getByRole('button', { name: 'Connect wallet' });
    expect(connectButton).toHaveFocus();

    await user.keyboard('{Enter}');
    const picker = await screen.findByTestId('wallet-selection-modal');
    expect(picker).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByTestId('wallet-selection-modal')).not.toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Connect wallet' })).toHaveFocus();
  });

  it('renders a persistent polite live region for step announcements', () => {
    mockUseWallet.mockReturnValue(walletState({ isConnected: true, publicKey: 'GABC' }));
    renderModal();

    const announcer = screen.getByTestId('investment-step-announcer');
    expect(announcer).toHaveAttribute('role', 'status');
    expect(announcer).toHaveAttribute('aria-live', 'polite');
  });
});
