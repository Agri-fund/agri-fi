'use client';

import { useState, useEffect } from 'react';
import { useWallet } from '../hooks/useWallet';
import { useTransactionProgress } from '../hooks/useTransactionProgress';
import { getStoredToken } from '../lib/api';
import { useToast } from './ui/ToastProvider';
import { OnChainProgressIndicator } from './OnChainProgressIndicator';
import { useCurrencyFormat } from '../hooks/useCurrencyFormat';
import { useNumberFormat } from '../hooks/useNumberFormat';

interface InvestmentFormProps {
  dealId: string;
  maxTokens: number;
  tokenPrice: number;
  /** Minimum investment lot size in USD (#835) */
  minLotSize?: number;
  /** Lot increment above the minimum in USD (#835) */
  lotStep?: number;
  onSuccess?: (investment: any) => void;
  onError?: (error: string) => void;
  onQuantityChange?: (quantity: number) => void;
}

interface InvestmentResponse {
  investment: {
    id: string;
    tokenAmount: number;
    amountUsd: number;
  };
  unsignedXdr: string;
}

interface SuccessState {
  investmentAmount: number;
  tokenCount: number;
  transactionId: string;
  isQueued?: boolean;
  investmentId?: string;
}

export const InvestmentForm: React.FC<InvestmentFormProps> = ({
  dealId,
  maxTokens,
  tokenPrice = 100,
  minLotSize,
  lotStep,
  onSuccess,
  onError,
  onQuantityChange,
}) => {
  const { toast, promise } = useToast();
  const { isConnected, publicKey, signTransaction } = useWallet();
  const txProgress = useTransactionProgress();
  const [tokenQuantity, setTokenQuantity] = useState<number | ''>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);
  const [showProgress, setShowProgress] = useState(false);

  // Cleanup polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [pollingInterval]);

  const safeQuantity = tokenQuantity === '' ? 0 : tokenQuantity;
  const totalAmount = safeQuantity * tokenPrice;

  // #835 — lot sizing (defaults keep legacy single-token behaviour)
  const lotSizeUsd = lotStep && lotStep > 0 ? lotStep : tokenPrice;
  const tokensPerLot = Math.max(1, Math.round(lotSizeUsd / tokenPrice));
  const minTokens =
    minLotSize && minLotSize > 0
      ? Math.max(1, Math.ceil(minLotSize / tokenPrice))
      : 1;
  const availableLots = Math.floor((maxTokens * tokenPrice) / lotSizeUsd);

  const adjustLot = (direction: 1 | -1) => {
    setTokenQuantity((prev) => {
      const current = prev === '' ? 0 : prev;
      const next = current + direction * tokensPerLot;
      return Math.min(maxTokens, Math.max(0, next));
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubmitting) return;

    if (!isConnected || !publicKey) {
      toast('Please connect your wallet first', 'warning');
      return;
    }

    if (safeQuantity < minTokens || safeQuantity > maxTokens) {
      toast(
        minLotSize && minLotSize > tokenPrice
          ? `Minimum investment for this deal is ${minLotSize} USD (${minTokens} tokens)`
          : `Token quantity must be between ${minTokens} and ${maxTokens}`,
        'warning',
      );
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    setShowProgress(true);
    txProgress.setSimulating();

    const investmentFlow = async () => {
      const token = getStoredToken();
      if (!token) {
        throw new Error('Please log in first');
      }

      // Step 1: Create pending investment (simulating phase)
      const idempotencyKey = crypto.randomUUID();
      const createResponse = await fetch('/api/investments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          tradeDealId: dealId,
          tokenAmount: safeQuantity,
          amountUsd: totalAmount,
        }),
      });

      if (!createResponse.ok) {
        const errorData = await createResponse.json();
        throw new Error(errorData.message || 'Failed to create investment');
      }

      const investmentData: InvestmentResponse = await createResponse.json();

      // Step 2: Sign transaction (simulating → submitting)
      txProgress.setSubmitting();
      const signedXdr = await signTransaction(investmentData.unsignedXdr);

      // Step 3: Submit signed transaction to backend (submitting phase)
      const submitResponse = await fetch(`/api/investments/${investmentData.investment.id}/fund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          investorWalletAddress: publicKey,
          signedXdr,
        }),
      });

      if (!submitResponse.ok) {
        const errorData = await submitResponse.json();
        throw new Error(errorData.message || 'Failed to submit transaction');
      }

      return await submitResponse.json();
    };

    try {
      const finalResult = await promise(investmentFlow(), {
        loading: 'Processing Stellar investment...',
        success: 'Transaction signed and submitted! 🚀',
        error: 'Investment failed. Please try again.',
      });
      
      // Mark as confirmed once we get the result
      if (finalResult.stellarTxId) {
        txProgress.setConfirmed(finalResult.stellarTxId);
      }
      
      if (finalResult.status === 'queued') {
        setSuccess({
          investmentAmount: totalAmount,
          tokenCount: safeQuantity,
          transactionId: 'Processing... (queued)',
          isQueued: true,
          investmentId: finalResult.investmentId,
        });
        startPollingInvestmentStatus(finalResult.investmentId);
      } else {
        setSuccess({
          investmentAmount: totalAmount,
          tokenCount: safeQuantity,
          transactionId: finalResult.stellarTxId,
          isQueued: false,
        });
      }
      
      onSuccess?.(finalResult);
      setTokenQuantity(1);
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : 'Investment failed';
      setError(errorMessage);
      onError?.(errorMessage);
      setShowProgress(false);
      txProgress.reset();
    } finally {
      setIsSubmitting(false);
    }
  };

  const startPollingInvestmentStatus = (investmentId: string) => {
    // Clear any existing polling interval
    if (pollingInterval) {
      clearInterval(pollingInterval);
    }

    const interval = setInterval(async () => {
      try {
        const token = getStoredToken();
        if (!token) {
          clearInterval(interval);
          return;
        }

        const response = await fetch(`/api/investments/${investmentId}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch investment status');
        }

        const investment = await response.json();
        
        if (investment.status === 'confirmed' && investment.stellarTxId) {
          // Investment confirmed, update success state
          setSuccess(prev => prev ? {
            ...prev,
            transactionId: investment.stellarTxId,
            isQueued: false,
          } : null);
          
          clearInterval(interval);
          setPollingInterval(null);
        }
      } catch (error) {
        console.error('Error polling investment status:', error);
      }
    }, 5000); // Poll every 5 seconds

    setPollingInterval(interval);
  };

  if (!isConnected) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <p className="text-yellow-800 text-sm">
          Please connect your Stellar wallet to invest in this deal.
        </p>
      </div>
    );
  }

  // Show progress indicator while transaction is in-flight
  if (showProgress && txProgress.state !== 'confirmed') {
    return (
      <div className="space-y-4">
        <OnChainProgressIndicator
          state={txProgress.state}
          txHash={txProgress.txHash ?? undefined}
        />
        <p className="text-sm text-slate-600 text-center">
          Please wait while your investment is being processed on the Stellar network.
        </p>
      </div>
    );
  }

  const { formatCurrency } = useCurrencyFormat();
  const { formatNumber } = useNumberFormat();

  if (success) {
    return (
      <div className="space-y-4">
        {/* Show the progress indicator in confirmed state */}
        {txProgress.state === 'confirmed' && (
          <OnChainProgressIndicator
            state="confirmed"
            txHash={success.transactionId !== 'Processing... (queued)' ? success.transactionId : txProgress.txHash ?? undefined}
          />
        )}
        
        <div className={`${success.isQueued ? 'bg-blue-50 border-blue-200' : 'bg-green-50 border-green-200'} border rounded-lg p-6`}>
          <div className="flex items-center mb-4">
            <div className={`w-8 h-8 ${success.isQueued ? 'bg-blue-500' : 'bg-green-500'} rounded-full flex items-center justify-center mr-3`}>
              {success.isQueued ? (
                <svg className="w-5 h-5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </div>
            <h3 className={`text-lg font-semibold ${success.isQueued ? 'text-blue-800' : 'text-green-800'}`}>
              {success.isQueued ? 'Investment Processing...' : 'Investment Successful!'}
            </h3>
          </div>
          
          <div className={`space-y-2 text-sm ${success.isQueued ? 'text-blue-700' : 'text-green-700'}`}>
            <p><strong>Investment Amount:</strong> {formatCurrency(success.investmentAmount, 'USD')}</p>
            <p><strong>Tokens Purchased:</strong> {formatNumber(success.tokenCount)}</p>
            {success.transactionId && success.transactionId !== 'Processing... (queued)' && (
              <p><strong>{success.isQueued ? 'Status:' : 'Transaction ID:'}</strong> 
                <span className="font-mono text-xs break-all ml-1">
                  {success.transactionId}
                </span>
              </p>
            )}
            {success.isQueued && (
              <p className="text-xs italic">
                Your investment is being processed. This page will update automatically when complete.
              </p>
            )}
          </div>
          
          <button
            onClick={() => {
              setSuccess(null);
              setShowProgress(false);
              txProgress.reset();
            }}
            className={`mt-4 text-sm ${success.isQueued ? 'text-blue-600 hover:text-blue-800' : 'text-green-600 hover:text-green-800'} underline`}
          >
            Make Another Investment
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="tokenQuantity" className="block text-sm font-medium text-gray-700 mb-2">
          Number of Tokens
        </label>
        <div className="flex items-center space-x-2">
          <button
            type="button"
            aria-label="Decrease lot size"
            onClick={() => adjustLot(-1)}
            disabled={isSubmitting || safeQuantity <= minTokens}
            className="w-10 h-10 flex items-center justify-center border border-gray-300 rounded-md text-lg font-semibold hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            &minus;
          </button>
          <input
            type="number"
            id="tokenQuantity"
            min={minTokens}
            step={tokensPerLot}
            max={maxTokens}
            value={tokenQuantity === '' ? '' : tokenQuantity}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              const qty = isNaN(val) ? 0 : val;
              setTokenQuantity(isNaN(val) ? '' : val);
              onQuantityChange?.(qty);
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center"
            disabled={isSubmitting}
          />
          <button
            type="button"
            aria-label="Increase lot size"
            onClick={() => adjustLot(1)}
            disabled={isSubmitting || safeQuantity + tokensPerLot > maxTokens}
            className="w-10 h-10 flex items-center justify-center border border-gray-300 rounded-md text-lg font-semibold hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            +
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Maximum available: {formatNumber(maxTokens)} tokens
        </p>
      </div>

      <div className="bg-gray-50 p-3 rounded-md">
        <div className="flex justify-between text-sm">
          <span>Price per lot:</span>
          <span>{formatCurrency(lotSizeUsd, 'USD')}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>Available lots remaining:</span>
          <span>{formatNumber(availableLots)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>Quantity:</span>
          <span>{formatNumber(safeQuantity)}</span>
        </div>
        <div className="flex justify-between font-semibold border-t pt-2 mt-2">
          <span>Total Investment:</span>
          <span>{formatCurrency(totalAmount, 'USD')}</span>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting || safeQuantity < minTokens || safeQuantity > maxTokens}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white py-2 px-4 rounded-md font-medium transition-colors"
      >
        {isSubmitting ? 'Processing Investment...' : `Invest ${formatCurrency(totalAmount, 'USD')}`}
      </button>

      <p className="text-xs text-gray-500 text-center">
        This will open Freighter to sign the transaction. Make sure you&apos;re on Stellar testnet.
      </p>
    </form>
  );
};