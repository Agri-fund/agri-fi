/**
 * WalletSelectionModal unit tests — Issue #853
 *
 * Tests cover:
 * - Rendering when open / closed
 * - Freighter detected vs. not detected (install guide)
 * - Albedo option always visible
 * - WalletConnect placeholder (disabled / coming soon)
 * - Network mismatch banner
 * - Error message rendering
 * - Connecting spinner
 * - onConnect called with correct provider
 * - onClose called on backdrop click and close button
 * - Escape key closes modal
 * - Accessibility: role, aria-modal, aria-labelledby
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WalletSelectionModal } from '../wallet/WalletSelectionModal';
import type { WalletSelectionModalProps } from '../wallet/WalletSelectionModal';

// next-intl is already mocked globally in jest.setup.ts
// useTranslations returns (key) => key, so t('wallet.freighter.name') → 'freighter.name'
// Since the component uses useTranslations('wallet'), the key path is relative.

const defaultProps: WalletSelectionModalProps = {
  isOpen: true,
  onClose: jest.fn(),
  onConnect: jest.fn().mockResolvedValue(undefined),
  availableWallets: [],
  isConnecting: false,
  error: null,
};

function renderModal(overrides: Partial<WalletSelectionModalProps> = {}) {
  const props = { ...defaultProps, ...overrides };
  return render(<WalletSelectionModal {...props} />);
}

describe('WalletSelectionModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Visibility ─────────────────────────────────────────────────────────────

  it('renders nothing when isOpen is false', () => {
    renderModal({ isOpen: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the dialog when isOpen is true', () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('has correct accessibility attributes on the dialog', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'wsm-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'wsm-description');
  });

  // ── Wallet options ─────────────────────────────────────────────────────────

  it('renders the Freighter option', () => {
    renderModal();
    expect(screen.getByTestId('wsm-freighter-btn')).toBeInTheDocument();
  });

  it('renders the Albedo option', () => {
    renderModal();
    expect(screen.getByTestId('wsm-albedo-btn')).toBeInTheDocument();
  });

  it('renders WalletConnect as coming-soon (disabled)', () => {
    renderModal();
    const wc = screen.getByTestId('wsm-walletconnect-btn');
    expect(wc).toBeInTheDocument();
    expect(wc).toHaveAttribute('aria-disabled', 'true');
    // Should not be a <button> element (it's a <div>) or at least not interactive
    expect(wc.tagName.toLowerCase()).not.toBe('button');
  });

  // ── Freighter detection ────────────────────────────────────────────────────

  it('shows "Detected" badge when Freighter is in availableWallets', () => {
    renderModal({ availableWallets: ['freighter'] });
    // The mock t() returns the key, so it returns 'detected'
    expect(screen.getByText('detected')).toBeInTheDocument();
  });

  it('shows install link when Freighter is not in availableWallets', () => {
    renderModal({ availableWallets: [] });
    expect(screen.getByTestId('wsm-freighter-install-link')).toBeInTheDocument();
  });

  it('shows install guide when Freighter is not installed', () => {
    renderModal({ availableWallets: [] });
    expect(screen.getByTestId('wsm-freighter-install-guide')).toBeInTheDocument();
    expect(screen.getByTestId('wsm-freighter-guide-link')).toBeInTheDocument();
  });

  it('does not show install guide when Freighter is installed', () => {
    renderModal({ availableWallets: ['freighter'] });
    expect(screen.queryByTestId('wsm-freighter-install-guide')).not.toBeInTheDocument();
  });

  // ── Network mismatch banner ───────────────────────────────────────────────

  it('does not show network mismatch banner when networks match', () => {
    renderModal({ expectedNetwork: 'testnet', detectedNetwork: 'testnet' });
    expect(screen.queryByTestId('network-mismatch-banner')).not.toBeInTheDocument();
  });

  it('shows network mismatch banner when networks differ', () => {
    renderModal({ expectedNetwork: 'testnet', detectedNetwork: 'mainnet' });
    expect(screen.getByTestId('network-mismatch-banner')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('does not show network mismatch banner when expectedNetwork is null', () => {
    renderModal({ expectedNetwork: null, detectedNetwork: 'mainnet' });
    expect(screen.queryByTestId('network-mismatch-banner')).not.toBeInTheDocument();
  });

  it('does not show network mismatch banner when detectedNetwork is null', () => {
    renderModal({ expectedNetwork: 'testnet', detectedNetwork: null });
    expect(screen.queryByTestId('network-mismatch-banner')).not.toBeInTheDocument();
  });

  // ── Error display ──────────────────────────────────────────────────────────

  it('shows error message when error prop is set', () => {
    renderModal({ error: 'User denied access' });
    expect(screen.getByTestId('wsm-error')).toBeInTheDocument();
    expect(screen.getByText('User denied access')).toBeInTheDocument();
  });

  it('does not show error element when error is null', () => {
    renderModal({ error: null });
    expect(screen.queryByTestId('wsm-error')).not.toBeInTheDocument();
  });

  // ── Connecting state ───────────────────────────────────────────────────────

  it('shows connecting indicator while isConnecting is true', () => {
    renderModal({ isConnecting: true });
    expect(screen.getByTestId('wsm-connecting')).toBeInTheDocument();
  });

  it('does not show connecting indicator when not connecting', () => {
    renderModal({ isConnecting: false });
    expect(screen.queryByTestId('wsm-connecting')).not.toBeInTheDocument();
  });

  it('disables wallet buttons while connecting', () => {
    renderModal({ isConnecting: true });
    expect(screen.getByTestId('wsm-freighter-btn')).toBeDisabled();
    expect(screen.getByTestId('wsm-albedo-btn')).toBeDisabled();
  });

  // ── onConnect callbacks ────────────────────────────────────────────────────

  it('calls onConnect with "freighter" when Freighter button is clicked', async () => {
    const onConnect = jest.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderModal({ availableWallets: ['freighter'], onConnect });

    await user.click(screen.getByTestId('wsm-freighter-btn'));

    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onConnect).toHaveBeenCalledWith('freighter');
  });

  it('calls onConnect with "albedo" when Albedo button is clicked', async () => {
    const onConnect = jest.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderModal({ onConnect });

    await user.click(screen.getByTestId('wsm-albedo-btn'));

    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onConnect).toHaveBeenCalledWith('albedo');
  });

  // ── Close behaviour ────────────────────────────────────────────────────────

  it('calls onClose when the close button is clicked', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    renderModal({ onClose });

    await user.click(screen.getByTestId('wsm-close-btn'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the backdrop is clicked', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    renderModal({ onClose });

    await user.click(screen.getByTestId('wallet-selection-backdrop'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when clicking inside the dialog panel', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    renderModal({ onClose });

    await user.click(screen.getByTestId('wallet-selection-modal'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when the Escape key is pressed', async () => {
    const onClose = jest.fn();
    const user = userEvent.setup();
    renderModal({ onClose });

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── Install link stopPropagation ──────────────────────────────────────────

  it('clicking the Freighter install link does not trigger onConnect', async () => {
    const onConnect = jest.fn();
    const user = userEvent.setup();
    renderModal({ availableWallets: [], onConnect });

    // Click the install link — should NOT bubble to the parent button onClick
    const installLink = screen.getByTestId('wsm-freighter-install-link');
    await user.click(installLink);

    expect(onConnect).not.toHaveBeenCalled();
  });
});
