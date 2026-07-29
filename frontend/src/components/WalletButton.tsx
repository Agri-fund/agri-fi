'use client';

import { useWallet, WalletProvider } from '../hooks/useWallet';
import { useTranslations } from 'next-intl';
import { useRef, useEffect, useState } from 'react';

interface WalletButtonProps {
  onWalletLinked?: (publicKey: string) => void;
}

/**
 * Connect Wallet modal + button.
 * Supports Freighter (browser extension) and Albedo (web-based signer).
 * Issue #83 — Integrate Freighter & Albedo for Client-Side Signing
 */
export const WalletButton: React.FC<WalletButtonProps> = ({ onWalletLinked }) => {
  const t = useTranslations();
  const {
    isConnected,
    publicKey,
    provider,
    availableWallets,
    isLoading,
    error,
    connect,
    disconnect,
  } = useWallet();
  const [showModal, setShowModal] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const handleConnect = async (selectedProvider: WalletProvider) => {
    try {
      setLinkError(null);
      setIsLinking(true);

      const connectedPublicKey = await connect(selectedProvider);

      // Link wallet to user account via API
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

  // Focus management: trap focus inside modal when open, restore focus when closed
  useEffect(() => {
    if (showModal) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement;
      // Focus the close button or first interactive element in the modal
      setTimeout(() => {
        const closeButton = modalRef.current?.querySelector('button[aria-label="' + t('wallet.closeDialog') + '"]') as HTMLButtonElement;
        if (closeButton) {
          closeButton.focus();
        }
      }, 0);
    } else if (previouslyFocusedRef.current) {
      // Restore focus to button that opened modal
      previouslyFocusedRef.current.focus();
    }
  }, [showModal, t]);

  if (isConnected) {
    return (
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
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          aria-label={t('wallet.disconnect')}
        >
          {t('wallet.disconnect')}
        </button>
      </div>
    );
  }

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

      {/* Connect Wallet Modal */}
      {showModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowModal(false);
            }
          }}
        >
          <div 
            className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4"
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-modal-title"
            aria-describedby="wallet-modal-description"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 id="wallet-modal-title" className="text-lg font-semibold text-gray-800">
                {t('wallet.title')}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none focus:outline-none focus:ring-2 focus:ring-gray-400 rounded p-1"
                aria-label={t('wallet.closeDialog')}
              >
                ×
              </button>
            </div>

            <p id="wallet-modal-description" className="text-sm text-gray-500 mb-5">
              {t('wallet.description')}
            </p>

            <div className="space-y-3">
              {/* Freighter */}
              <button
                onClick={() => handleConnect('freighter')}
                disabled={isLinking}
                className="w-full flex items-center gap-3 border border-gray-200 hover:border-blue-400 rounded-xl px-4 py-3 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-400"
                aria-label={t('wallet.openDialog')}
              >
                <span className="text-xl" aria-hidden="true">🚀</span>
                <div className="text-left">
                  <p className="text-sm font-medium text-gray-800">{t('wallet.freighter.name')}</p>
                  <p className="text-xs text-gray-400">{t('wallet.freighter.type')}</p>
                </div>
                {availableWallets.includes('freighter') ? (
                  <span className="ml-auto text-xs text-green-500">{t('wallet.detected')}</span>
                ) : (
                  <a
                    href="https://freighter.app/"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="ml-auto text-xs text-blue-500 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-400 rounded px-1"
                  >
                    {t('wallet.install')}
                  </a>
                )}
              </button>

              {/* Albedo */}
              <button
                onClick={() => handleConnect('albedo')}
                disabled={isLinking}
                className="w-full flex items-center gap-3 border border-gray-200 hover:border-purple-400 rounded-xl px-4 py-3 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-purple-400"
                aria-label={t('wallet.openDialog')}
              >
                <span className="text-xl" aria-hidden="true">🌐</span>
                <div className="text-left">
                  <p className="text-sm font-medium text-gray-800">{t('wallet.albedo.name')}</p>
                  <p className="text-xs text-gray-400">{t('wallet.albedo.type')}</p>
                </div>
                <span className="ml-auto text-xs text-green-500">{t('wallet.alwaysAvailable')}</span>
              </button>
            </div>

            {linkError && (
              <p className="mt-4 text-sm text-red-600" role="alert">{linkError}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
