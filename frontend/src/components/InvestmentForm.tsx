'use client';

import { useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { getStoredToken } from '../lib/api';

interface InvestmentFormProps {
  dealId: string;
  maxTokens: number;
  tokenPrice: number;
  onSuccess?: (investment: any) => void;
  onError?: (error: string) => void;
}

interface InvestmentResponse {
  id: string;
  unsignedXdr: string;
  tokenAmount: number;
  amountUsd: number;
}

export const InvestmentForm: React.FC<InvestmentFormProps> = ({
  dealId,
  maxTokens,
  tokenPrice = 100,
  onSuccess,
  onError,
}) => {
  const { isConnected, publicKey, signTransaction } = useWallet();
  const [tokenQuantity, setTokenQuantity] = useState<number | ''>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<any>(null);

  const safeQuantity = tokenQuantity === '' ? 0 : tokenQuantity;
  const totalAmount = safeQuantity * tokenPrice;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isConnected || !publicKey) {
      setError('Please connect your wallet first');
      return;
    }

    if (safeQuantity < 1 || safeQuantity > maxTokens) {
      setError(`Token quantity must be between 1 and ${maxTokens}`);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const token = getStoredToken();
      if (!token) {
        throw new Error('Please log in first');
      }

      // Step 1: Create pending investment and get unsigned XDR
      const createResponse = await fetch('/api/investments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          tradeDealId: dealId,
          tokenAmount: safeQuantity,
        }),
      });

      if (!createResponse.ok) {
        const errorData = await createResponse.json();
        throw new Error(errorData.message || 'Failed to create investment');
      }

      const investmentData: InvestmentResponse = await createResponse.json();

      // Step 2: Sign the transaction with Freighter
      const signedXdr = await signTransaction(investmentData.unsignedXdr);

      // Step 3: Submit signed transaction to backend
      const submitResponse = await fetch(`/api/investments/${investmentData.id}/submit-tx`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          signedXdr,
        }),
      });

      if (!submitResponse.ok) {
        const errorData = await submitResponse.json();
        throw new Error(errorData.message || 'Failed to submit transaction');
      }

      const finalResult = await submitResponse.json();
      
      setSuccess({
        investmentAmount: totalAmount,
        tokenCount: safeQuantity,
        transactionId: finalResult.stellarTxId,
      });
      
      onSuccess?.(finalResult);
      
      // Reset form
      setTokenQuantity(1);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Investment failed';
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
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

  if (success) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-6">
        <div className="flex items-center mb-4">
          <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center mr-3">
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-green-800">Investment Successful!</h3>
        </div>
        
        <div className="space-y-2 text-sm text-green-700">
          <p><strong>Investment Amount:</strong> ${success.investmentAmount.toLocaleString()}</p>
          <p><strong>Tokens Purchased:</strong> {success.tokenCount}</p>
          {success.transactionId && (
            <p><strong>Transaction ID:</strong> 
              <span className="font-mono text-xs break-all ml-1">
                {success.transactionId}
              </span>
            </p>
          )}
        </div>
        
        <button
          onClick={() => setSuccess(null)}
          className="mt-4 text-sm text-green-600 hover:text-green-800 underline"
        >
          Make Another Investment
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="tokenQuantity" className="block text-sm font-medium text-gray-700 mb-2">
          Number of Tokens
        </label>
        <input
          type="number"
          id="tokenQuantity"
          min="1"
          max={maxTokens}
          value={tokenQuantity === '' ? '' : tokenQuantity}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            setTokenQuantity(isNaN(val) ? '' : val);
          }}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          disabled={isSubmitting}
        />
        <p className="text-xs text-gray-500 mt-1">
          Maximum available: {maxTokens} tokens
        </p>
      </div>

      <div className="bg-gray-50 p-3 rounded-md">
        <div className="flex justify-between text-sm">
          <span>Token Price:</span>
          <span>${tokenPrice}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>Quantity:</span>
          <span>{safeQuantity}</span>
        </div>
        <div className="flex justify-between font-semibold border-t pt-2 mt-2">
          <span>Total Investment:</span>
          <span>${totalAmount.toLocaleString()}</span>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting || safeQuantity < 1 || safeQuantity > maxTokens}
        className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white py-2 px-4 rounded-md font-medium transition-colors"
      >
        {isSubmitting ? 'Processing Investment...' : `Invest $${totalAmount.toLocaleString()}`}
      </button>

      <p className="text-xs text-gray-500 text-center">
        This will open Freighter to sign the transaction. Make sure you&apos;re on Stellar testnet.
      </p>
    </form>
  );
};