'use client';

/**
 * AnchorWidget
 *
 * Fiat on/off-ramp widget using Stellar Anchors (SEP-24).
 * Supports NGN, KES, GHS, ZAR, USD → USDC deposits and withdrawals.
 */

import { useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import {
  SupportedFiat,
  initiateDeposit,
  initiateWithdrawal,
} from '../lib/anchor';
import { getStoredToken } from '../lib/api';

const CURRENCIES: { code: SupportedFiat; label: string; flag: string }[] = [
  { code: 'NGN', label: 'Nigerian Naira', flag: '🇳🇬' },
  { code: 'KES', label: 'Kenyan Shilling', flag: '🇰🇪' },
  { code: 'GHS', label: 'Ghanaian Cedi', flag: '🇬🇭' },
  { code: 'ZAR', label: 'South African Rand', flag: '🇿🇦' },
  { code: 'USD', label: 'US Dollar', flag: '🇺🇸' },
];

type Mode = 'deposit' | 'withdraw';

export function AnchorWidget() {
  const { isConnected, publicKey } = useWallet();
  const [mode, setMode] = useState<Mode>('deposit');
  const [currency, setCurrency] = useState<SupportedFiat>('NGN');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected || !publicKey) {
      setError('Connect your Stellar wallet first');
      return;
    }

    const token = getStoredToken();
    if (!token) {
      setError('Please log in first');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = {
        fiatCurrency: currency,
        stellarAccount: publicKey,
        amount: amount || undefined,
        jwtToken: token,
      };

      const result =
        mode === 'deposit'
          ? await initiateDeposit(params)
          : await initiateWithdrawal(params);

      // Open anchor's interactive flow in a popup
      const popup = window.open(
        result.url,
        'anchor-flow',
        'width=500,height=700,scrollbars=yes',
      );

      if (!popup) {
        // Fallback: redirect in same tab
        window.location.href = result.url;
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 max-w-md">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        Fiat ↔ USDC
      </h3>

      {/* Mode toggle */}
      <div className="flex rounded-lg bg-gray-100 p-1 mb-5">
        {(['deposit', 'withdraw'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
              mode === m
                ? 'bg-white text-green-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {m === 'deposit' ? '↓ Deposit' : '↑ Withdraw'}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Currency selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {mode === 'deposit' ? 'Deposit from' : 'Withdraw to'}
          </label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as SupportedFiat)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.label} ({c.code})
              </option>
            ))}
          </select>
        </div>

        {/* Amount */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Amount (optional)
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Leave blank to set in anchor flow"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        {/* Wallet status */}
        {!isConnected && (
          <p className="text-sm text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
            Connect your Stellar wallet to continue
          </p>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !isConnected}
          className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
        >
          {loading
            ? 'Opening anchor...'
            : mode === 'deposit'
            ? `Deposit ${currency} → USDC`
            : `Withdraw USDC → ${currency}`}
        </button>
      </form>

      <p className="text-xs text-gray-400 mt-4 text-center">
        Powered by Stellar Anchors · SEP-24
      </p>
    </div>
  );
}
