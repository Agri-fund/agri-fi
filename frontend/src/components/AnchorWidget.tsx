'use client';

/**
 * AnchorWidget
 *
 * Fiat on/off-ramp widget using Stellar Anchors (SEP-24).
 * Supports NGN, KES, GHS, ZAR, USD → USDC deposits and withdrawals.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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

type Anchor = {
  id: string;
  name: string;
  homeDomain?: string;
  interactiveUrl?: string;
  currencies?: string[];
};

type TxStatus =
  | 'pending_user_transfer_start'
  | 'pending_anchor'
  | 'pending_stellar'
  | 'pending_external'
  | 'needs_more_info'
  | 'completed'
  | 'error'
  | 'refunded'
  | string;

type Transaction = {
  id: string;
  status: TxStatus;
  message?: string;
  moreInfoUrl?: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
const POLL_INTERVAL_MS = 3000;

const STATUS_LABELS: Record<string, string> = {
  pending_user_transfer_start: 'Waiting for your transfer',
  pending_anchor: 'Anchor processing',
  pending_stellar: 'Settling on Stellar',
  pending_external: 'Waiting on external provider',
  needs_more_info: 'More information needed',
  completed: 'Completed',
  error: 'Failed',
  refunded: 'Refunded',
};

export function AnchorWidget() {
  const { isConnected, publicKey } = useWallet();
  const [mode, setMode] = useState<Mode>('deposit');
  const [currency, setCurrency] = useState<SupportedFiat>('NGN');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [anchorsLoading, setAnchorsLoading] = useState(false);
  const [selectedAnchorId, setSelectedAnchorId] = useState<string>('');

  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [interactiveUrl, setInteractiveUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Load available anchors
  useEffect(() => {
    let cancelled = false;
    const token = getStoredToken();
    if (!token) return;

    setAnchorsLoading(true);
    fetch(`${API_BASE}/v1/stellar/anchors`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load anchors');
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const list: Anchor[] = Array.isArray(data) ? data : data?.anchors ?? [];
        setAnchors(list);
        if (list.length > 0) setSelectedAnchorId(list[0].id);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load anchors');
      })
      .finally(() => {
        if (!cancelled) setAnchorsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Poll transaction status
  const startPolling = useCallback(
    (txId: string) => {
      stopPolling();
      const token = getStoredToken();
      if (!token) return;

      const poll = async () => {
        try {
          const res = await fetch(
            `${API_BASE}/v1/stellar/transactions/${txId}`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (!res.ok) throw new Error('Failed to fetch transaction status');
          const data: Transaction = await res.json();
          setTransaction(data);

          if (data.status === 'completed' || data.status === 'error' || data.status === 'refunded') {
            stopPolling();
            if (data.status === 'completed') setInteractiveUrl(null);
          }
        } catch (err: any) {
          setError(err.message || 'Failed to fetch transaction status');
          stopPolling();
        }
      };

      poll();
      pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    },
    [stopPolling],
  );

  useEffect(() => stopPolling, [stopPolling]);

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
    setTransaction(null);

    try {
      const params = {
        fiatCurrency: currency,
        stellarAccount: publicKey,
        amount: amount || undefined,
        jwtToken: token,
        anchorId: selectedAnchorId || undefined,
      };

      const result =
        mode === 'deposit'
          ? await initiateDeposit(params)
          : await initiateWithdrawal(params);

      const url = result.url;
      setInteractiveUrl(url);

      // Open anchor's interactive flow in a popup
      const popup = window.open(
        url,
        'anchor-flow',
        'width=500,height=700,scrollbars=yes',
      );

      if (!popup) {
        // Fallback: redirect in same tab
        window.location.href = url;
      }

      if (result.id) {
        startPolling(result.id);
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshBalance = () => {
    // Trigger a balance refresh by reloading the page context
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('stellar:refresh-balance'));
    }
  };

  const statusLabel = transaction
    ? STATUS_LABELS[transaction.status] || transaction.status
    : null;

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
        {/* Anchor selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Anchor
          </label>
          <select
            value={selectedAnchorId}
            onChange={(e) => setSelectedAnchorId(e.target.value)}
            disabled={anchorsLoading || anchors.length === 0}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-100"
          >
            {anchorsLoading && <option value="">Loading anchors…</option>}
            {!anchorsLoading && anchors.length === 0 && (
              <option value="">No anchors available</option>
            )}
            {anchors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.homeDomain ? ` (${a.homeDomain})` : ''}
              </option>
            ))}
          </select>
        </div>

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

      {/* Transaction progress */}
      {transaction && (
        <div className="mt-5 border-t border-gray-100 pt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Status</span>
            <span
              className={`text-xs font-semibold px-2 py-1 rounded-full ${
                transaction.status === 'completed'
                  ? 'bg-green-100 text-green-700'
                  : transaction.status === 'error' || transaction.status === 'refunded'
                  ? 'bg-red-100 text-red-700'
                  : transaction.status === 'needs_more_info'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-blue-100 text-blue-700'
              }`}
            >
              {statusLabel}
            </span>
          </div>

          {transaction.status === 'needs_more_info' && (
            <div className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mt-2">
              <p className="mb-2">
                The anchor needs more information to continue.
              </p>
              {interactiveUrl && (
                <button
                  type="button"
                  onClick={() =>
                    window.open(
                      interactiveUrl,
                      'anchor-flow',
                      'width=500,height=700,scrollbars=yes',
                    )
                  }
                  className="text-amber-800 underline font-medium"
                >
                  Reopen anchor flow
                </button>
              )}
            </div>
          )}

          {transaction.status === 'completed' && (
            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={handleRefreshBalance}
                className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium py-2 rounded-lg text-sm transition-colors"
              >
                Refresh USDC balance
              </button>
              <a
                href="/invest"
                className="block text-center w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 rounded-lg text-sm transition-colors"
              >
                Proceed to investment
              </a>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-gray-400 mt-4 text-center">
        Powered by Stellar Anchors · SEP-24
      </p>
    </div>
  );
}
