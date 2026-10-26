'use client';

import React, { useMemo, useState } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { LEADERBOARD_METRICS, METRIC_LABELS } from '@/lib/social-trading/leaderboard';
import type {
  LeaderboardEntry,
  LeaderboardMetric,
  SocialMetricWindow,
} from '@/lib/social-trading/types';
import { RiskTierBadge } from './TraderProfileCard';

export interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  metric: LeaderboardMetric;
  window: SocialMetricWindow;
  onMetricChange: (metric: LeaderboardMetric) => void;
  onWindowChange: (window: SocialMetricWindow) => void;
  region: string;
  regions: string[];
  onRegionChange: (region: string) => void;
  onSelectTrader: (traderId: string) => void;
  followingIds?: string[];
}

const WINDOWS: SocialMetricWindow[] = ['1m', '3m', '6m', '12m', 'all'];

const TIER_STYLES: Record<LeaderboardEntry['tierBadge'], string> = {
  Platinum: 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-900/60',
  Gold: 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900/60',
  Silver: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  Bronze: 'bg-orange-50 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-900/60',
};

type SortKey = 'rank' | 'metricValue' | 'roiPct' | 'sharpe' | 'maxDrawdownPct' | 'followerCount';

export const LeaderboardTable: React.FC<LeaderboardTableProps> = ({
  entries,
  metric,
  window,
  onMetricChange,
  onWindowChange,
  region,
  regions,
  onRegionChange,
  onSelectTrader,
  followingIds = [],
}) => {
  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortDesc, setSortDesc] = useState(false);

  const sorted = useMemo(() => {
    const rows = [...entries];
    rows.sort((a, b) => {
      if (sortKey === 'rank') return sortDesc ? b.rank - a.rank : a.rank - b.rank;
      if (sortKey === 'maxDrawdownPct') return sortDesc ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey];
      return sortDesc ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey];
    });
    return rows;
  }, [entries, sortKey, sortDesc]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDesc((prev) => !prev);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  const SortHeader: React.FC<{ label: string; column: SortKey }> = ({ label, column }) => (
    <th scope="col" className="py-2 pr-3 whitespace-nowrap">
      <button
        type="button"
        onClick={() => toggleSort(column)}
        aria-label={`Sort by ${label}`}
        aria-pressed={sortKey === column}
        className={`font-semibold hover:text-slate-900 dark:hover:text-white transition ${
          sortKey === column ? 'text-emerald-600 dark:text-emerald-400' : ''
        }`}
      >
        {label}
        {sortKey === column && <span aria-hidden="true">{sortDesc ? ' (desc)' : ' (asc)'}</span>}
      </button>
    </th>
  );

  const windowLabel = entries[0]?.windowLabel ?? '';

  return (
    <section
      aria-label="Trader leaderboard"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4"
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-slate-900 dark:text-white">Leaderboard</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Ranked by {METRIC_LABELS[metric]} · {windowLabel || `window ${window}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <label className="flex items-center gap-1.5 font-medium text-slate-600 dark:text-slate-300">
            <span>
              Leaderboard metric
              <select
                value={metric}
                onChange={(e) => onMetricChange(e.target.value as LeaderboardMetric)}
                aria-label="Leaderboard metric"
                className="ml-1.5 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
              >
                {LEADERBOARD_METRICS.map((m) => (
                  <option key={m} value={m}>
                    {METRIC_LABELS[m]}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <label className="flex items-center gap-1.5 font-medium text-slate-600 dark:text-slate-300">
            Metric window
            <select
              value={window}
              onChange={(e) => onWindowChange(e.target.value as SocialMetricWindow)}
              aria-label="Metric window"
              className="ml-1.5 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
            >
              {WINDOWS.map((w) => (
                <option key={w} value={w}>
                  {w === 'all' ? 'All time' : w}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 font-medium text-slate-600 dark:text-slate-300">
            Region
            <select
              value={region}
              onChange={(e) => onRegionChange(e.target.value)}
              aria-label="Region"
              className="ml-1.5 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
            >
              <option value="all">All regions</option>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <caption className="sr-only">Trader leaderboard rankings</caption>
          <thead>
            <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <SortHeader label="Rank" column="rank" />
              <th scope="col" className="py-2 pr-3 font-semibold">Trader</th>
              <SortHeader label={METRIC_LABELS[metric]} column="metricValue" />
              <SortHeader label="ROI" column="roiPct" />
              <SortHeader label="Sharpe" column="sharpe" />
              <SortHeader label="Max drawdown" column="maxDrawdownPct" />
              <SortHeader label="Followers" column="followerCount" />
              <th scope="col" className="py-2 pr-3 font-semibold">Trend</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Tier</th>
              <th scope="col" className="py-2 font-semibold">Risk</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry) => {
              const following = followingIds.includes(entry.traderId);
              return (
                <tr
                  key={entry.traderId}
                  data-trader-id={entry.traderId}
                  onClick={() => onSelectTrader(entry.traderId)}
                  className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer transition"
                >
                  <td className="py-2 pr-3 font-black text-slate-900 dark:text-white">{entry.rank}</td>
                  <td className="py-2 pr-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectTrader(entry.traderId);
                      }}
                      aria-label={`View ${entry.displayName} profile`}
                      className="font-bold text-slate-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 transition text-left"
                    >
                      {entry.displayName}
                      {entry.verified && (
                        <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/60">
                          Verified
                        </span>
                      )}
                    </button>
                    <span className="block text-[10px] text-slate-500 dark:text-slate-400">
                      {entry.region ?? 'Global'} · ${entry.aumUsd.toLocaleString()} AUM
                      {following && ' · you follow this trader'}
                    </span>
                  </td>
                  <td className="py-2 pr-3 font-bold text-emerald-700 dark:text-emerald-400">
                    {entry.metricValue.toFixed(2)}
                    {METRIC_LABELS[entry.metric].includes('%') || entry.metric === 'roi' ? '%' : ''}
                  </td>
                  <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">{entry.roiPct}%</td>
                  <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">{entry.sharpe.toFixed(2)}</td>
                  <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">{entry.maxDrawdownPct}%</td>
                  <td className="py-2 pr-3 text-slate-600 dark:text-slate-300">
                    {entry.followerCount.toLocaleString()}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`inline-flex items-center gap-1 font-semibold ${
                        entry.trendPct >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                      aria-label={`Trend ${entry.trendPct}%`}
                    >
                      {entry.trendPct >= 0 ? (
                        <TrendingUp size={13} aria-hidden="true" />
                      ) : (
                        <TrendingDown size={13} aria-hidden="true" />
                      )}
                      {entry.trendPct}%
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${TIER_STYLES[entry.tierBadge]}`}
                      aria-label={`${entry.tierBadge} tier`}
                    >
                      {entry.tierBadge}
                    </span>
                  </td>
                  <td className="py-2">
                    {entry.riskTier ? (
                      <RiskTierBadge tier={entry.riskTier} score={entry.riskScore} />
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={10} className="py-6 text-center text-slate-500 dark:text-slate-400">
                  No traders match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};
