/**
 * Performance leaderboards (issue #1212).
 *
 * Ranking is windowed (the last N months of a trader's return series), deterministic
 * and eligibility-filtered. Tie-break order is documented on `compareEntries`.
 */

import {
  buildPerformanceHistory,
  computeConsistencyScore,
  computeRiskAdjustedMetrics,
  compoundReturn,
  round,
  windowReturns,
} from './profiles';
import type {
  LeaderboardEntry,
  LeaderboardOptions,
  SocialMetricWindow,
  TraderProfile,
} from './types';

export const METRIC_LABELS: Record<LeaderboardEntry['metric'], string> = {
  roi: 'Total ROI',
  sharpe: 'Sharpe ratio',
  sortino: 'Sortino ratio',
  calmar: 'Calmar ratio',
  winRate: 'Win rate',
  consistency: 'Consistency score',
};

export const METRIC_UNITS: Record<LeaderboardEntry['metric'], 'percent' | 'ratio'> = {
  roi: 'percent',
  sharpe: 'ratio',
  sortino: 'ratio',
  calmar: 'ratio',
  winRate: 'percent',
  consistency: 'percent',
};

export const LEADERBOARD_METRICS = Object.keys(METRIC_LABELS) as LeaderboardEntry['metric'][];

export const DEFAULT_LEADERBOARD_RULES = {
  minTenureMonths: 3,
  minAumUsd: 0,
  limit: 50,
  tierCutoffs: { platinum: 0.15, gold: 0.4, silver: 0.7 },
} as const;

/**
 * Tie-break rules (deterministic):
 *  1. selected metric value, descending
 *  2. window ROI, descending (a `sharpe` board still favours better absolute return)
 *  3. assets under management, descending (deeper liquidity)
 *  4. tenure, descending (longer verifiable record)
 *  5. trader id, ascending
 */
export function compareEntries(a: LeaderboardEntry, b: LeaderboardEntry): number {
  return (
    b.metricValue - a.metricValue ||
    b.roiPct - a.roiPct ||
    b.aumUsd - a.aumUsd ||
    b.tenureMonths - a.tenureMonths ||
    a.traderId.localeCompare(b.traderId)
  );
}

export function windowLabel(window: SocialMetricWindow): string {
  if (window === 'all') return 'All time';
  const months = Number.parseInt(window, 10);
  return `Last ${months} month${months === 1 ? '' : 's'}`;
}

/** Percentile cutoffs of the *sorted* board: top 15% Platinum, 40% Gold, 70% Silver. */
export function tierBadgeFor(index: number, total: number): LeaderboardEntry['tierBadge'] {
  const percentile = total <= 1 ? 0 : index / total;
  const { platinum, gold, silver } = DEFAULT_LEADERBOARD_RULES.tierCutoffs;
  if (percentile < platinum) return 'Platinum';
  if (percentile < gold) return 'Gold';
  if (percentile < silver) return 'Silver';
  return 'Bronze';
}

/** Compounded change of the equity curve over the last three periods. */
export function trendPct(returns: number[]): number {
  if (returns.length < 2) return 0;
  const recentCount = Math.min(3, returns.length);
  const head = returns.slice(0, returns.length - recentCount);
  const startMultiple = head.reduce((multiple, r) => multiple * (1 + r), 1);
  const endMultiple = returns.reduce((multiple, r) => multiple * (1 + r), 1);
  if (startMultiple <= 0) return 0;
  return round((endMultiple / startMultiple - 1) * 100, 2);
}

export function windowedMetricValue(
  metric: LeaderboardEntry['metric'],
  profile: TraderProfile,
  returns: number[],
): number {
  switch (metric) {
    case 'sharpe':
      return computeRiskAdjustedMetrics(returns).sharpe;
    case 'sortino':
      return computeRiskAdjustedMetrics(returns).sortino;
    case 'calmar':
      return computeRiskAdjustedMetrics(returns).calmar;
    case 'winRate':
      // Win rate is measured on settled deals, which a short window may not contain.
      return profile.metrics.winRatePct;
    case 'consistency':
      return computeConsistencyScore(returns);
    case 'roi':
    default:
      return round(compoundReturn(returns) * 100, 2);
  }
}

export function isEligible(profile: TraderProfile, options: LeaderboardOptions): boolean {
  const minTenure = options.minTenureMonths ?? DEFAULT_LEADERBOARD_RULES.minTenureMonths;
  const minAum = options.minAumUsd ?? DEFAULT_LEADERBOARD_RULES.minAumUsd;
  if (profile.metrics.tenureMonths < minTenure) return false;
  if (profile.aumUsd < minAum) return false;
  if (profile.monthlyReturns.length === 0) return false;
  if (options.region && options.region !== 'all') {
    const regions = new Set(profile.regions.map((r) => r.toLowerCase()));
    if (!regions.has(options.region.toLowerCase())) return false;
  }
  return true;
}

export function buildLeaderboard(
  profiles: TraderProfile[],
  options: LeaderboardOptions = {},
): LeaderboardEntry[] {
  const metric = options.metric ?? 'roi';
  const window = options.window ?? '12m';
  const limit = options.limit ?? DEFAULT_LEADERBOARD_RULES.limit;

  const rows: LeaderboardEntry[] = profiles
    .filter((profile) => isEligible(profile, options))
    .map((profile) => {
      const returns = windowReturns(profile.monthlyReturns, window);
      const adjusted = computeRiskAdjustedMetrics(returns);
      const history = buildPerformanceHistory(
        returns,
        window === 'all'
          ? profile.firstReturnPeriod
          : shiftPeriod(profile.firstReturnPeriod, profile.monthlyReturns.length - returns.length),
      );

      return {
        rank: 0,
        traderId: profile.traderId,
        displayName: profile.displayName,
        region: profile.regions[0] ?? null,
        metric,
        metricValue: windowedMetricValue(metric, profile, returns),
        window,
        windowLabel: windowLabel(window),
        roiPct: round(compoundReturn(returns) * 100, 2),
        sharpe: adjusted.sharpe,
        sortino: adjusted.sortino,
        calmar: adjusted.calmar,
        maxDrawdownPct: round(adjusted.maxDrawdown * 100, 2),
        winRatePct: profile.metrics.winRatePct,
        consistencyScore: computeConsistencyScore(returns),
        aumUsd: profile.aumUsd,
        tenureMonths: profile.metrics.tenureMonths,
        followerCount: profile.followerCount,
        tierBadge: 'Bronze',
        riskScore: options.riskScores?.[profile.traderId]?.score ?? null,
        riskTier: options.riskScores?.[profile.traderId]?.tier ?? null,
        verified: profile.verified,
        trendPct: trendPct(returns),
        sparkline: history.map((point) => point.cumulativePct),
      };
    });

  const sorted = [...rows].sort(compareEntries);
  const total = sorted.length;

  return sorted
    .map((row, index) => ({
      ...row,
      rank: index + 1,
      tierBadge: tierBadgeFor(index, total),
    }))
    .slice(0, limit);
}

function shiftPeriod(period: string, months: number): string {
  if (months <= 0) return period;
  const parsed = /^(\d{4})-(\d{2})$/.exec(period);
  if (!parsed) return period;
  const index = Number(parsed[1]) * 12 + (Number(parsed[2]) - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function riskTierSummary(
  entries: LeaderboardEntry[],
): Record<NonNullable<LeaderboardEntry['riskTier']>, number> {
  const summary = { low: 0, moderate: 0, elevated: 0, high: 0 };
  for (const entry of entries) {
    if (entry.riskTier) summary[entry.riskTier] += 1;
  }
  return summary;
}
