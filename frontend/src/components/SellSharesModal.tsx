'use client';

import { useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { useTransactionProgress } from '../hooks/useTransactionProgress';
import { OnChainProgressIndicator } from './OnChainProgressIndicator';

interface SellSharesModalProps {
  tradeTokenCode: string;
  tradeTokenIssuer: string;
  maxTokens: number;
  onClose: () => void;
  onSuccess?: (txId: string) => void;
}

/**
 * Issue #112 — Secondary Market Offer Creation for Trade Tokens
 *
 * Lets investors list their trade-token shares for sale on the Stellar DEX
 * by creating a manageSellOffer transaction signed via their connected wallet.
 */
export const SellSharesModal: React.FC<SellSharesModalProps> = ({
  tradeTokenCode,
  tradeTokenIssuer,
  maxTokens,
  onClose,
  onSuccess,
}) => {
  const { isConnected, publicKey, signTransaction } = useWallet();
  const txProgress = useTransactionProgress();
  const [tokenAmount, setTokenAmount] = useState<number | ''>(1);
  const [pricePerToken, setPricePerToken] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successTxId, setSuccessTxId] = useState<string | null>(null);
  const [showProgress, setShowProgress] = useState(false);

  const safeAmount = tokenAmount === '' ? 0 : tokenAmount;
  const totalValue = pricePerToken ? safeAmount * parseFloat(pricePerToken) : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isConnected || !publicKey) {
      setError('Please connect your wallet first.');
      return;
    }

    if (safeAmount < 1 || safeAmount > maxTokens) {
      setError(`Token amount must be between 1 and ${maxTokens}.`);
      return;
    }

    const price = parseFloat(pricePerToken);
    if (!pricePerToken || isNaN(price) || price <= 0) {
      setError('Please enter a valid price per token.');
      return;
    }

    setIsSubmitting(true);
    setShowProgress(true);
    txProgress.setSimulating();
    
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) throw new Error('Please log in first.');

      // Step 1: Get unsigned XDR for the sell offer from backend (simulating)
      const buildRes = await fetch('/api/investments/sell-offer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          sellerWalletAddress: publicKey,
          tradeTokenCode,
          tradeTokenIssuer,
          tokenAmount: safeAmount,
          pricePerToken: price.toFixed(7),
          offerId: 0,
        }),
      });

      if (!buildRes.ok) {
        const err = await buildRes.json().catch(() => ({}));
        throw new Error(err.message ?? 'Failed to build sell offer.');
      }

      const { unsignedXdr } = await buildRes.json();

      // Step 2: Sign with wallet (simulating → submitting)
      txProgress.setSubmitting();
      const signedXdr = await signTransaction(unsignedXdr);

      // Step 3: Submit signed XDR (submitting phase)
      const submitRes = await fetch('/api/stellar/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ signedXdr }),
      });

      if (!submitRes.ok) {
        const err = await submitRes.json().catch(() => ({}));
        throw new Error(err.message ?? 'Failed to submit transaction.');
      }

      const result = await submitRes.json();
      const txId = result.hash ?? result.txId ?? 'submitted';
      
      // Mark as confirmed
      txProgress.setConfirmed(txId);
      
      setSuccessTxId(txId);
      onSuccess?.(txId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sell offer failed.');
      setShowProgress(false);
      txProgress.reset();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sell-shares-modal-title"
    >
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 id="sell-shares-modal-title" className="text-lg font-semibold text-gray-900">
            Sell Shares — {tradeTokenCode}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-xl leading-none"
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        {/* Show progress indicator while transaction is in-flight */}
        {showProgress && txProgress.state !== 'confirmed' && (
          <div className="mb-4">
            <OnChainProgressIndicator
              state={txProgress.state}
              txHash={txProgress.txHash ?? undefined}
            />
            <p className="text-xs text-slate-700 text-center mt-3">
              Processing your sell offer on the Stellar network...
            </p>
          </div>
        )}

        {successTxId ? (
          <div className="space-y-3">
            {/* Show confirmed progress indicator */}
            {txProgress.state === 'confirmed' && (
              <OnChainProgressIndicator
                state="confirmed"
                txHash={successTxId}
              />
            )}
            
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <p className="text-green-900 font-medium mb-1">Sell offer created!</p>
              <p className="text-xs text-green-800 font-mono break-all">
                Tx: {successTxId}
              </p>
              <button
                onClick={onClose}
                className="mt-4 w-full bg-green-700 hover:bg-green-800 text-white py-2 rounded-xl text-sm font-medium"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isConnected && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-900">
                Connect your wallet to list shares.
              </div>
            )}

            <div>
              <label htmlFor="sell-token-amount" className="block text-sm font-medium text-gray-800 mb-1">
                Tokens to sell
              </label>
              <input
                id="sell-token-amount"
                type="number"
                min={1}
                max={maxTokens}
                value={tokenAmount}
                onChange={(e) =>
                  setTokenAmount(e.target.value === '' ? '' : Number(e.target.value))
                }
                aria-describedby="sell-token-max-help"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder={`1 – ${maxTokens}`}
              />
              <p id="sell-token-max-help" className="text-xs text-gray-600 mt-1">Max available: {maxTokens}</p>
            </div>

            <div>
              <label htmlFor="sell-token-price" className="block text-sm font-medium text-gray-800 mb-1">
                Price per token (USDC)
              </label>
              <input
                id="sell-token-price"
                type="number"
                min="0.0000001"
                step="0.01"
                value={pricePerToken}
                onChange={(e) => setPricePerToken(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="e.g. 1.05"
              />
            </div>

            {safeAmount > 0 && totalValue > 0 && (
              <div className="bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-700">
                You will receive up to{' '}
                <span className="font-semibold text-gray-900">
                  {totalValue.toFixed(2)} USDC
                </span>{' '}
                when the offer fills.
              </div>
            )}

            {error && (
              <p className="text-sm text-red-700">{error}</p>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !isConnected}
              className="w-full bg-green-700 hover:bg-green-800 disabled:bg-gray-400 text-white py-2.5 rounded-xl text-sm font-medium transition-colors"
            >
              {isSubmitting ? 'Submitting…' : 'Sign & List Shares'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
