'use client';

import { useWallet, WalletProvider } from '../hooks/useWallet';
import { useState } from 'react';

interface WalletButtonProps {
  onWalletLinked?: (publicKey: string) => void;
}

/**
 * Connect Wallet modal + button.
 * Supports Freighter (browser extension) and Albedo (web-based signer).
 * Issue #83 — Integrate Freighter & Albedo for Client-Side Signing
 */
export const WalletButton: React.FC<WalletButtonProps> = ({ onWalletLinked }) => {
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

  const handleConnect = async (selectedProvider: WalletProvider) => {
    try {
      setLinkError(null);
      setIsLinking(true);

      const connectedPublicKey = await connect(selectedProvider);

      // Link wallet to user account via API
      const token = localStorage.getItem('authToken');
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
          throw new Error(errorData.message ?? 'Failed to link wallet');
        }
      }

      onWalletLinked?.(connectedPublicKey);
      setShowModal(false);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Failed to connect wallet');
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

  if (isConnected) {
    return (
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 bg-green-500 rounded-full" />
          <span className="text-sm text-gray-700 font-mono">
            {publicKey ? truncateAddress(publicKey) : 'Connected'}
          </span>
          {provider && (
            <span className="text-xs text-gray-400 capitalize">({provider})</span>
          )}
        </div>
        <button
          onClick={handleDisconnect}
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end">
      <button
        onClick={() => setShowModal(true)}
        disabled={isLoading || isLinking}
        className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
      >
        {isLoading || isLinking ? 'Connecting…' : 'Connect Wallet'}
      </button>

      {(error || linkError) && (
        <p className="mt-2 text-sm text-red-600 max-w-xs">{error ?? linkError}</p>
      )}

      {/* Connect Wallet Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-800">
                Connect a Stellar Wallet
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <p className="text-sm text-gray-500 mb-5">
              Your private key never leaves your wallet. Agri-Fi only ever sees
              your public key.
            </p>

            <div className="space-y-3">
              {/* Freighter */}
              <button
                onClick={() => handleConnect('freighter')}
                disabled={isLinking}
                className="w-full flex items-center gap-3 border border-gray-200 hover:border-blue-400 rounded-xl px-4 py-3 transition-colors disabled:opacity-50"
              >
                <span className="text-xl">🚀</span>
                <div className="text-left">
                  <p className="text-sm font-medium text-gray-800">Freighter</p>
                  <p className="text-xs text-gray-400">Browser extension wallet</p>
                </div>
                {availableWallets.includes('freighter') ? (
                  <span className="ml-auto text-xs text-green-500">Detected</span>
                ) : (
                  <a
                    href="https://freighter.app/"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="ml-auto text-xs text-blue-500 hover:underline"
                  >
                    Install
                  </a>
                )}
              </button>

              {/* Albedo */}
              <button
                onClick={() => handleConnect('albedo')}
                disabled={isLinking}
                className="w-full flex items-center gap-3 border border-gray-200 hover:border-purple-400 rounded-xl px-4 py-3 transition-colors disabled:opacity-50"
              >
                <span className="text-xl">🌐</span>
                <div className="text-left">
                  <p className="text-sm font-medium text-gray-800">Albedo</p>
                  <p className="text-xs text-gray-400">Web-based signer — no install needed</p>
                </div>
                <span className="ml-auto text-xs text-green-500">Always available</span>
              </button>
            </div>

            {linkError && (
              <p className="mt-4 text-sm text-red-600">{linkError}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
