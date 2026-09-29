'use client';
/**
 * DealHealthWidget — Issue #1002
 *
 * Surfaces the composite deal-health snapshot (risk score, funding pace vs.
 * timeline, milestone progress vs. expected schedule) computed server-side by
 * DealHealthService (`GET /trade-deals/:id/health`). Renders a color-coded
 * status pill plus two compact "stat tile" sparklines (funding pace,
 * milestone pace).
 *
 * Auto-refreshes every 60s while mounted (matching the polling interval used
 * by LiveStatsBand) and degrades gracefully when offline or when the request
 * fails: it keeps showing the last known snapshot with a subtle notice rather
 * than blanking, and stops issuing network requests while offline instead of
 * retrying aggressively.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  Tooltip,
  YAxis,
} from 'recharts';
import { useOnline } from '@/hooks/useOnline';

// ── Types ────────────────────────────────────────────────────────────────────

export type DealHealthStatus = 'Healthy' | 'Warning' | 'At-risk';

export interface DealHealthSnapshot {
  dealId: string;
  riskScore: number;
  riskRating: 'Low' | 'Medium' | 'High' | 'Very High';
  status: DealHealthStatus;
  funding: {
    raisedPct: number;
    expectedPctByNow: number;
    totalValue: number;
    totalInvested: number;
    daysRemaining: number;
    timeline: { date: string; raisedPct: number }[];
  };
  milestones: {
    completedCount: number;
    expectedCountByNow: number;
    totalCount: number;
    timeline: { date: string; completedCount: number }[];
  };
  computedAt: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000;

const STATUS_META: Record<
  DealHealthStatus,
  { badgeClass: string; icon: string; stroke: string; label: string }
> = {
  Healthy: { badgeClass: 'badge-green', icon: '✓', stroke: '#16a34a', label: 'Healthy' },
  Warning: { badgeClass: 'badge-yellow', icon: '⚠', stroke: '#d97706', label: 'Warning' },
  'At-risk': { badgeClass: 'badge-red', icon: '⛔', stroke: '#dc2626', label: 'At-risk' },
};

// ── Component ────────────────────────────────────────────────────────────────

interface DealHealthWidgetProps {
  dealId: string;
  /** Condensed layout for use inside portfolio/dashboard cards. */
  compact?: boolean;
  className?: string;
}

export function DealHealthWidget({
  dealId,
  compact = false,
  className = '',
}: DealHealthWidgetProps) {
  const isOnline = useOnline();
  const isOnlineRef = useRef(isOnline);
  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

  const [snapshot, setSnapshot] = useState<DealHealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    // Degrade gracefully offline: don't hammer the network while disconnected,
    // but still surface a clear state instead of leaving the widget spinning
    // forever (or, on a later poll, silently going stale with no indication).
    if (!isOnlineRef.current) {
      setError('Unable to load health data');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/trade-deals/${dealId}/health`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`Request failed with status ${res.status}`);
      }
      const data: DealHealthSnapshot = await res.json();
      setSnapshot(data);
      setError(null);
    } catch {
      // Keep whatever snapshot we already have (if any) rather than
      // crashing or blanking the widget.
      setError('Unable to load health data');
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  // Initial load on mount ("auto-refresh on view").
  useEffect(() => {
    void fetchHealth();
  }, [fetchHealth]);

  // Auto-refresh while mounted. The interval keeps ticking while offline but
  // fetchHealth() no-ops in that case, so we never retry aggressively.
  useEffect(() => {
    const interval = setInterval(() => void fetchHealth(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  // ── Loading skeleton (first load only) ──────────────────────────────────

  const containerClass = compact
    ? 'bg-slate-50 rounded-xl p-3'
    : 'card p-5';

  if (loading && !snapshot) {
    return (
      <div className={`${containerClass} space-y-3 ${className}`} aria-label="Loading deal health…">
        <div className="flex items-center justify-between">
          <div className="h-4 w-24 skeleton rounded-lg" />
          <div className="h-5 w-20 skeleton rounded-full" />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="h-16 skeleton rounded-xl" />
          <div className="h-16 skeleton rounded-xl" />
        </div>
      </div>
    );
  }

  // ── Hard error state (never loaded successfully) ────────────────────────

  if (error && !snapshot) {
    return (
      <div className={`alert-error ${className}`} role="alert">
        <span aria-hidden="true">⚠</span>
        <div>
          <p>Unable to load health data</p>
          <p className="text-xs mt-1 opacity-80">
            {isOnline
              ? 'The deal health service could not be reached. Please try again shortly.'
              : 'You appear to be offline. We will retry automatically once you reconnect.'}
          </p>
          <button
            type="button"
            onClick={() => void fetchHealth()}
            className="underline text-xs mt-1"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!snapshot) return null;

  const meta = STATUS_META[snapshot.status];
  const fundingDelta =
    Math.round((snapshot.funding.raisedPct - snapshot.funding.expectedPctByNow) * 10) / 10;
  const milestoneDelta =
    snapshot.milestones.completedCount - snapshot.milestones.expectedCountByNow;

  return (
    <div
      className={`${containerClass} space-y-4 ${className}`}
      data-testid="deal-health-widget"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="section-title">Deal Health</h3>
        <span className={`${meta.badgeClass} inline-flex items-center gap-1`}>
          <span aria-hidden="true">{meta.icon}</span>
          {meta.label}
        </span>
      </div>

      {/* Stale-data notice: shown when a background refresh failed but we still
          have a previously loaded snapshot to display. */}
      {error && (
        <p className="text-xs text-amber-600" role="status">
          Showing last known data — {isOnline ? 'retrying in the background…' : 'you appear to be offline.'}
        </p>
      )}

      <div className={`grid ${compact ? 'grid-cols-2 gap-3' : 'sm:grid-cols-2 gap-4'}`}>
        <StatSparkline
          label="Funding pace"
          value={`${snapshot.funding.raisedPct.toFixed(0)}%`}
          delta={fundingDelta}
          deltaLabel="vs. expected pace"
          data={snapshot.funding.timeline.map((p) => ({ x: p.date, y: p.raisedPct }))}
          stroke={meta.stroke}
        />
        <StatSparkline
          label="Milestone pace"
          value={`${snapshot.milestones.completedCount}/${snapshot.milestones.totalCount}`}
          delta={milestoneDelta}
          deltaLabel="vs. expected schedule"
          data={snapshot.milestones.timeline.map((p) => ({ x: p.date, y: p.completedCount }))}
          stroke={meta.stroke}
        />
      </div>

      {!compact && (
        <p className="text-xs text-slate-400">
          Risk score {snapshot.riskScore} ({snapshot.riskRating}) · Updated{' '}
          {new Date(snapshot.computedAt).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}

// ── Stat tile + sparkline ────────────────────────────────────────────────────

interface StatSparklineProps {
  label: string;
  value: string;
  delta: number;
  deltaLabel: string;
  data: { x: string; y: number }[];
  stroke: string;
}

function StatSparkline({
  label,
  value,
  delta,
  deltaLabel,
  data,
  stroke,
}: StatSparklineProps) {
  const deltaPositive = delta >= 0;
  const roundedDelta = Math.round(delta * 10) / 10;

  return (
    <div className="bg-slate-50 rounded-xl p-3">
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
        {label}
      </p>
      <div className="flex items-end justify-between gap-2 mt-1">
        <div>
          <p className="text-lg font-bold text-slate-900">{value}</p>
          <p
            className={`text-[11px] font-medium ${
              deltaPositive ? 'text-emerald-600' : 'text-red-500'
            }`}
          >
            {deltaPositive ? '+' : ''}
            {roundedDelta} {deltaLabel}
          </p>
        </div>
        <div className="w-20 h-10 flex-shrink-0">
          {data.length >= 2 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                <YAxis hide domain={['dataMin', 'dataMax']} />
                <Tooltip
                  content={({ active, payload }) =>
                    active && payload && payload.length ? (
                      <div className="rounded-md bg-slate-900 text-white text-[10px] px-2 py-1 shadow-lg">
                        {payload[0].value}
                      </div>
                    ) : null
                  }
                />
                <Line
                  type="monotone"
                  dataKey="y"
                  stroke={stroke}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-300">
              —
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default DealHealthWidget;
