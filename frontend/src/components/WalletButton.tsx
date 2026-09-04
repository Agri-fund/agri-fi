'use client';

/**
 * WalletButton — Issue #853
 *
 * Top-level "Connect Wallet" button.
 * Delegates the wallet selection UI to WalletSelectionModal and handles the
 * post-connect API call to link the wallet to the user account.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useWallet, WalletProvider } from '../hooks/useWallet';
import { WalletSelectionModal } from './wallet/WalletSelectionModal';

interface WalletButtonProps {
  onWalletLinked?: (publicKey: string) => void;
}

export const WalletButton: React.FC<WalletButtonProps> = ({ onWalletLinked }) => {
  const t = useTranslations();
  const {
    isConnected,
    publicKey,
    provider,
    availableWallets,
    isLoading,
    error,
    networkMismatch,
    detectedNetwork,
    configuredNetwork,
    connect,
    disconnect,
  } = useWallet();

  const [showModal, setShowModal] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleConnect = async (selectedProvider: WalletProvider) => {
    try {
      setLinkError(null);
      setIsLinking(true);

      const connectedPublicKey = await connect(selectedProvider);

      // Optionally link wallet to user account via API
      const token = localStorage.getItem('auth_token');
      if (token) {
        const response = await fetch('/api/auth/wallet', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ walletAddress: connectedPublicKey }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message ?? t('wallet.errorLink'));
        }
      }

      onWalletLinked?.(connectedPublicKey);
      setShowModal(false);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : t('wallet.errorConnect'));
    } finally {
      setIsLinking(false);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setLinkError(null);
  };

  const truncateAddress = (address: string) =>
    `${address.slice(0, 6)}...${address.slice(-4)}`;

  // ── Connected state ────────────────────────────────────────────────────────

  if (isConnected) {
    return (
      <div className="flex flex-col items-end gap-1">
        {/* Network mismatch warning banner */}
        {networkMismatch && (
          <div
            role="alert"
            className="flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-700"
          >
            <svg
              className="w-3.5 h-3.5 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            {t('wallet.onboarding.networkMismatch', {
              detected: detectedNetwork ?? '',
              expected: configuredNetwork,
            })}
          </div>
        )}

        {/* Wallet address + disconnect */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-green-500 rounded-full" />
            <span className="text-sm text-gray-700 font-mono">
              {publicKey ? truncateAddress(publicKey) : t('wallet.connected')}
            </span>
            {provider && (
              <span className="text-xs text-gray-400 capitalize">({provider})</span>
            )}
          </div>
          <button
            onClick={handleDisconnect}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400 rounded px-1"
            aria-label={t('wallet.disconnect')}
          >
            {t('wallet.disconnect')}
          </button>
        </div>
      </div>
    );
  }

  // ── Disconnected state ─────────────────────────────────────────────────────

  return (
    <div className="flex flex-col items-end">
      <button
        onClick={() => setShowModal(true)}
        disabled={isLoading || isLinking}
        className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        aria-label={t('wallet.openDialog')}
      >
        {isLoading || isLinking ? t('wallet.connecting') : t('wallet.connectButton')}
      </button>

      {(error || linkError) && (
        <p className="mt-2 text-sm text-red-600 max-w-xs">{error ?? linkError}</p>
      )}

      <WalletSelectionModal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          setLinkError(null);
        }}
        onConnect={handleConnect}
        availableWallets={availableWallets}
        isConnecting={isLinking}
        error={linkError}
        expectedNetwork={configuredNetwork}
        detectedNetwork={detectedNetwork}
      />
    </div>
  );
};
