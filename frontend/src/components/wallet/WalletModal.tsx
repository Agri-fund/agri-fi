'use client';

/**
 * WalletModal — Issue #243
 * Freighter wallet connection modal with connecting / connected / disconnected states.
 * Detects Freighter installation and shows install link if missing.
 * Displays truncated public key and network badge (Testnet / Public).
 */

import { useStellarWallet } from '@/hooks/useStellarWallet';

interface WalletModalProps {
  onClose: () => void;
}

export function WalletModal({ onClose }: WalletModalProps) {
  const { status, displayKey, network, isFreighterInstalled, error, connect, disconnect } =
    useStellarWallet();

  const handleConnect = async () => {
    await connect();
    if (status === 'connected') onClose();
  };

  const handleDisconnect = () => {
    disconnect();
    onClose();
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-modal-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal-panel w-full max-w-sm">
        {/* Header */}
        <div className="modal-header">
          <h2 id="wallet-modal-title" className="text-base font-bold text-slate-900">
            Stellar Wallet
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Close wallet modal"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="modal-body space-y-4">
          {/* Network badge */}
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
                network === 'Public'
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-amber-50 text-amber-700'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  network === 'Public' ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              {network}
            </span>
          </div>

          {/* Status: connected */}
          {status === 'connected' && displayKey && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0" />
                <span className="text-sm font-semibold text-emerald-800">Connected</span>
              </div>
              <p className="text-xs text-slate-500 font-mono break-all">{displayKey}</p>
              <button
                onClick={handleDisconnect}
                className="btn-secondary text-xs w-full"
              >
                Disconnect
              </button>
            </div>
          )}

          {/* Status: connecting */}
          {status === 'connecting' && (
            <div className="flex items-center gap-3 py-4">
              <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <span className="text-sm text-slate-600">Connecting to Freighter…</span>
            </div>
          )}

          {/* Status: disconnected */}
          {status === 'disconnected' && (
            <div className="space-y-3">
              {isFreighterInstalled ? (
                <button
                  onClick={handleConnect}
                  className="btn-primary w-full flex items-center justify-center gap-2"
                >
                  <span>🚀</span> Connect Freighter
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="alert-warning text-sm">
                    Freighter extension not detected. Install it to connect your Stellar wallet.
                  </div>
                  <a
                    href="https://freighter.app/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-primary w-full flex items-center justify-center gap-2"
                  >
                    <span>🚀</span> Install Freighter
                  </a>
                </div>
              )}
              <p className="text-xs text-slate-400 text-center">
                Your private key never leaves your wallet.
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="alert-error text-sm">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
