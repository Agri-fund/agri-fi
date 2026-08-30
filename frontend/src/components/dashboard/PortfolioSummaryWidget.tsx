'use client';

import React from 'react';
import StatCard from '../StatCard';
import PortfolioAllocationChart from './PortfolioAllocationChart';
import { usePortfolioSummary } from '../../hooks/usePortfolioSummary';

/**
 * Investor dashboard portfolio summary widget (#789): total invested,
 * current value, expected ROI, active deal count, and an allocation-by-deal
 * chart. Self-contained — fetches its own data from `GET /investments/summary`
 * so it can be dropped onto any dashboard page without prop wiring.
 */
export default function PortfolioSummaryWidget({ className = '' }: { className?: string }) {
  const { summary, loading, error } = usePortfolioSummary();

  if (error) {
    return (
      <div className={`card p-6 text-center ${className}`} role="alert">
        <p className="text-sm font-semibold text-red-600">Couldn't load your portfolio summary</p>
        <p className="text-xs text-slate-400 mt-1">{error}</p>
      </div>
    );
  }

  const roiPct =
    summary && summary.totalInvested > 0
      ? ((summary.expectedReturns / summary.totalInvested - 1) * 100)
      : null;

  return (
    <div className={className}>
      <div
        data-testid="portfolio-summary-stats"
        className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-4"
      >
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card h-24 skeleton" aria-label="Loading…" />
          ))
        ) : (
          <>
            <StatCard
              label="Total Invested"
              value={summary?.totalInvested ?? 0}
              icon="💰"
              color="bg-violet-50"
              isCurrency
            />
            <StatCard
              label="Current Value"
              value={summary?.currentValue ?? 0}
              icon="📊"
              color="bg-blue-50"
              isCurrency
            />
            <StatCard
              label="ROI"
              value={roiPct != null ? `${roiPct.toFixed(1)}%` : '—'}
              icon="📈"
              color="bg-amber-50"
              trend={
                roiPct != null
                  ? `${roiPct >= 0 ? '+' : ''}${roiPct.toFixed(1)}% expected`
                  : undefined
              }
              trendUp={roiPct != null ? roiPct >= 0 : undefined}
            />
            <StatCard
              label="Active Deals"
              value={summary?.activeDealCount ?? 0}
              icon="🌾"
              color="bg-emerald-50"
            />
          </>
        )}
      </div>

      <PortfolioAllocationChart
        allocations={summary?.allocationByDeal ?? []}
        loading={loading}
      />
    </div>
  );
}
