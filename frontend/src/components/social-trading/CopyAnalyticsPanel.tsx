'use client';

import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CopyPerformanceStats, CopyVsOrganicComparison } from '@/lib/social-trading/types';

export interface CopyAnalyticsPanelProps {
  stats: CopyPerformanceStats;
  comparison: CopyVsOrganicComparison;
}

const usd = (value: number) => `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

const VERDICT_LABELS: Record<CopyVsOrganicComparison['verdict'], string> = {
  copying_ahead: 'Copying is ahead of self-directed picks',
  copying_behind: 'Copying is behind self-directed picks',
  even: 'Copying and self-directed picks are even',
};

export const CopyAnalyticsPanel: React.FC<CopyAnalyticsPanelProps> = ({ stats, comparison }) => {
  const cards = [
    { label: 'Success rate', value: `${stats.successRatePct}%`, hint: `${stats.successfulCopies}/${stats.totalCopies} copies profitable` },
    { label: 'Copy fidelity', value: stats.fidelity.toFixed(3), hint: `Tracking error ${stats.trackingErrorPct}%` },
    { label: 'Avg entry slippage', value: `${stats.avgSlippagePct}%`, hint: `Worst ${stats.worstSlippagePct}%` },
    { label: 'Beat-leader rate', value: `${stats.beatLeaderRatePct}%`, hint: 'Copies matching or beating the leader' },
    { label: 'Total P&L', value: usd(stats.totalPnlUsd), hint: `Fees ${usd(stats.totalFeesUsd)}` },
    { label: 'Profit factor', value: stats.profitFactor === null ? 'n/a' : String(stats.profitFactor), hint: `Gross profit ${usd(stats.grossProfitUsd)} / loss ${usd(stats.grossLossUsd)}` },
    { label: 'Avg return', value: `${stats.avgReturnPct}%`, hint: `Median ${stats.medianReturnPct}%` },
    { label: 'Avg holding', value: `${stats.avgHoldingDays} days`, hint: `Across ${stats.totalCopies} copies` },
  ];

  const monthlyData = stats.monthly.map((bucket) => ({
    month: bucket.monthKey,
    pnl: bucket.pnlUsd,
    successRate: bucket.successRatePct,
    copies: bucket.copies,
  }));

  const comparisonData = [
    { name: 'Copies', successRate: comparison.copies.successRatePct, avgReturn: comparison.copies.avgReturnPct },
    { name: 'Organic', successRate: comparison.organic.successRatePct, avgReturn: comparison.organic.avgReturnPct },
  ];

  return (
    <section
      aria-label="Copy trading analytics"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6"
    >
      <div>
        <h3 className="text-lg font-black text-slate-900 dark:text-white">Copy analytics</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Performance of copied trades for follower {stats.followerId || '—'}.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-4"
          >
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{card.label}</span>
            <p className="text-xl font-black text-slate-900 dark:text-white mt-1">{card.value}</p>
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5 inline-block">
              {card.hint}
            </span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-2">Monthly P&L and success rate</h4>
          <div role="img" aria-label="Bar and line chart of monthly copy PnL in USD and success rate percentage">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#64748b' }} domain={[0, 100]} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="left" dataKey="pnl" name="P&L (USD)" fill="#059669" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="successRate" name="Success rate %" stroke="#6366f1" strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-2">Copying versus self-directed</h4>
          <div role="img" aria-label="Bar chart comparing copy and organic success rate and average return">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={comparisonData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="successRate" name="Success rate %" fill="#059669" radius={[4, 4, 0, 0]} />
                <Bar dataKey="avgReturn" name="Avg return %" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div
            role="status"
            className={`mt-3 rounded-xl border p-3 text-xs font-semibold ${
              comparison.verdict === 'copying_ahead'
                ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
                : comparison.verdict === 'copying_behind'
                  ? 'border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300'
                  : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300'
            }`}
          >
            <p>{VERDICT_LABELS[comparison.verdict]}</p>
            <p className="mt-1 font-medium opacity-90">{comparison.summary}</p>
            <p className="mt-1 opacity-90">
              P&L delta: {usd(comparison.pnlDeltaUsd)} · success-rate delta {comparison.successRateDeltaPct} pts ·
              avg-return delta {comparison.avgReturnDeltaPct} pts
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-2">Monthly breakdown</h4>
          <table className="w-full text-xs">
            <caption className="sr-only">Copied trades grouped by calendar month</caption>
            <thead>
              <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th scope="col" className="py-1.5 pr-2 font-medium">Month</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">Copies</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">Success rate</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">Avg return</th>
                <th scope="col" className="py-1.5 font-medium">P&L</th>
              </tr>
            </thead>
            <tbody>
              {stats.monthly.map((bucket) => (
                <tr key={bucket.monthKey} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 pr-2 font-semibold text-slate-900 dark:text-white">{bucket.monthKey}</td>
                  <td className="py-1.5 pr-2 text-slate-600 dark:text-slate-300">{bucket.copies}</td>
                  <td className="py-1.5 pr-2 text-slate-600 dark:text-slate-300">{bucket.successRatePct}%</td>
                  <td className="py-1.5 pr-2 text-slate-600 dark:text-slate-300">{bucket.avgReturnPct}%</td>
                  <td
                    className={`py-1.5 font-bold ${
                      bucket.pnlUsd >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {usd(bucket.pnlUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-2">PnL attribution</h4>
          <table className="w-full text-xs">
            <caption className="sr-only">Realised PnL attributed per group</caption>
            <thead>
              <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th scope="col" className="py-1.5 pr-2 font-medium">Group</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">Copies</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">Deployed</th>
                <th scope="col" className="py-1.5 pr-2 font-medium">Contribution</th>
                <th scope="col" className="py-1.5 font-medium">P&L</th>
              </tr>
            </thead>
            <tbody>
              {stats.attribution.map((row) => (
                <tr key={row.key} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 pr-2 font-semibold text-slate-900 dark:text-white">{row.label}</td>
                  <td className="py-1.5 pr-2 text-slate-600 dark:text-slate-300">{row.copies}</td>
                  <td className="py-1.5 pr-2 text-slate-600 dark:text-slate-300">{usd(row.deployedUsd)}</td>
                  <td className="py-1.5 pr-2 text-slate-600 dark:text-slate-300">{row.contributionPct}%</td>
                  <td
                    className={`py-1.5 font-bold ${
                      row.pnlUsd >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {usd(row.pnlUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(stats.bestCopy || stats.worstCopy) && (
            <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              {stats.bestCopy && (
                <>
                  Best copy: {stats.bestCopy.dealId} at {stats.bestCopy.followerReturnPct}%.{' '}
                </>
              )}
              {stats.worstCopy && <>Worst copy: {stats.worstCopy.dealId} at {stats.worstCopy.followerReturnPct}%.</>}
            </p>
          )}
        </div>
      </div>
    </section>
  );
};
