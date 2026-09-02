'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';

// Mirrors the backend default (investments.service.ts's DEFAULT_COOLING_OFF_HOURS).
// The backend is the source of truth — if an operator overrides
// INVESTMENT_COOLING_OFF_HOURS, this countdown may read slightly off, but the
// cancel call itself is always validated server-side regardless of what this
// button shows.
const DEFAULT_COOLING_OFF_HOURS = 48;

function formatRemaining(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

interface CancelInvestmentButtonProps {
  investmentId: string;
  status: string;
  createdAt: string;
  onCancelled?: () => void;
}

/**
 * Cancel button + live countdown for the investment cooling-off window
 * (#788). Renders nothing once the investment is no longer pending or the
 * window has passed — the backend enforces both regardless, but there's no
 * point showing a button that can only fail.
 */
export default function CancelInvestmentButton({
  investmentId,
  status,
  createdAt,
  onCancelled,
}: CancelInvestmentButtonProps) {
  const deadline = new Date(createdAt).getTime() + DEFAULT_COOLING_OFF_HOURS * 60 * 60 * 1000;
  const [now, setNow] = useState(() => Date.now());
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  if (status !== 'pending') return null;
  const remainingMs = deadline - now;
  if (remainingMs <= 0) return null;

  async function handleCancel() {
    if (!window.confirm('Cancel this investment? This cannot be undone.')) return;
    setCancelling(true);
    setError(null);
    try {
      await apiClient.cancelInvestment(investmentId);
      onCancelled?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel investment');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handleCancel}
        disabled={cancelling}
        className="btn-secondary text-xs py-2 text-red-600 border-red-200 hover:bg-red-50 disabled:opacity-50"
      >
        {cancelling ? 'Cancelling…' : `Cancel (${formatRemaining(remainingMs)} left)`}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
