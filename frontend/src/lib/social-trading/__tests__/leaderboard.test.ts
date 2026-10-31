import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LEADERBOARD_RULES,
  LEADERBOARD_METRICS,
  METRIC_LABELS,
  METRIC_UNITS,
  buildLeaderboard,
  compareEntries,
  isEligible,
  riskTierSummary,
  tierBadgeFor,
  trendPct,
  windowLabel,
  windowedMetricValue,
} from '../leaderboard';
import { buildSampleProfiles } from '../sample-data';
import type { LeaderboardEntry, TraderProfile } from '../types';

function boardProfile(
  traderId: string,
  spec: {
    returns: number[];
    firstPeriod?: string;
    tenureMonths?: number;
    winRatePct?: number;
    aumUsd?: number;
    region?: string;
    verified?: boolean;
    followerCount?: number;
  },
): TraderProfile {
  return {
    traderId,
    displayName: traderId,
    regions: [spec.region ?? 'Kenya'],
    verified: spec.verified ?? true,
    aumUsd: spec.aumUsd ?? 100_000,
    followerCount: spec.followerCount ?? 0,
    firstReturnPeriod: spec.firstPeriod ?? '2026-07',
    monthlyReturns: spec.returns,
    metrics: {
      tenureMonths: spec.tenureMonths ?? 12,
      winRatePct: spec.winRatePct ?? 50,
    },
  } as unknown as TraderProfile;
}

// Hand-computed fixtures. Monthly returns compound to:
//   alpha  1.01 * 1.02 * 1.03 = 1.061106  ->  6.11 %
//   beta   1.06 * 0.98 * 1.02 = 1.059576  ->  5.96 %
//   gamma  0.99 * 1.04 * 1.01 = 1.039896  ->  3.99 %
//   delta  1.01 * 1.01 * 1.05 = 1.071053  ->  7.11 %
const ALPHA = boardProfile('alpha', {
  returns: [0.01, 0.02, 0.03],
  tenureMonths: 12,
  winRatePct: 60,
  aumUsd: 100_000,
  region: 'Kenya',
});
const BETA = boardProfile('beta', {
  returns: [0.06, -0.02, 0.02],
  tenureMonths: 30,
  winRatePct: 50,
  aumUsd: 200_000,
  region: 'Ghana',
});
const GAMMA = boardProfile('gamma', {
  returns: [-0.01, 0.04, 0.01],
  tenureMonths: 8,
  winRatePct: 75,
  aumUsd: 50_000,
  region: 'Kenya',
  verified: false,
});
const DELTA = boardProfile('delta', {
  returns: [0.01, 0.01, 0.05],
  tenureMonths: 24,
  winRatePct: 100,
  aumUsd: 300_000,
  region: 'Nigeria',
});
const ZETA = boardProfile('zeta', {
  returns: [0.1, -0.05, 0.01, 0.02, 0.03],
  firstPeriod: '2026-05',
  tenureMonths: 5,
  winRatePct: 40,
  aumUsd: 20_000,
  region: 'Uganda',
  verified: false,
});

const ALL: TraderProfile[] = [ALPHA, BETA, GAMMA, DELTA, ZETA];

describe('labels and metadata', () => {
  it('names every rankable metric and its unit', () => {
    expect(LEADERBOARD_METRICS).toEqual(['roi', 'sharpe', 'sortino', 'calmar', 'winRate', 'consistency']);
    expect(METRIC_LABELS).toEqual({
      roi: 'Total ROI',
      sharpe: 'Sharpe ratio',
      sortino: 'Sortino ratio',
      calmar: 'Calmar ratio',
      winRate: 'Win rate',
      consistency: 'Consistency score',
    });
    expect(METRIC_UNITS).toEqual({
      roi: 'percent',
      sharpe: 'ratio',
      sortino: 'ratio',
      calmar: 'ratio',
      winRate: 'percent',
      consistency: 'percent',
    });
  });

  it('spells windows out for the UI', () => {
    expect(windowLabel('all')).toBe('All time');
    expect(windowLabel('1m')).toBe('Last 1 month');
    expect(windowLabel('3m')).toBe('Last 3 months');
    expect(windowLabel('12m')).toBe('Last 12 months');
  });
});

describe('windowing', () => {
  it('slices the trailing months and re-bases the sparkline', () => {
    const [row] = buildLeaderboard([ZETA], { window: '3m' });
    expect(row.roiPct).toBe(6.11);
    expect(row.metricValue).toBe(6.11);
    expect(row.windowLabel).toBe('Last 3 months');
    expect(row.sparkline).toEqual([1, 3.02, 6.11]);
    expect(row.trendPct).toBe(6.11);
  });

  it('keeps the whole series when it is shorter than the window', () => {
    const [row] = buildLeaderboard([ZETA], { window: '12m' });
    expect(row.roiPct).toBe(10.89);
    expect(row.sparkline).toEqual([10, 4.5, 5.55, 7.66, 10.89]);
    expect(row.maxDrawdownPct).toBe(5);
  });

  it('measures trend over the last three periods only', () => {
    expect(trendPct([0.1, -0.05, 0.01, 0.02, 0.03])).toBe(6.11);
    expect(trendPct([0.1, -0.05])).toBe(4.5);
    expect(trendPct([0.1])).toBe(0);
    expect(trendPct([])).toBe(0);
    // A wiped-out head period makes the trend undefined, so it reports flat.
    expect(trendPct([-1, 0.5, 0.1, 0.2])).toBe(0);
  });
});

describe('windowed metric values', () => {
  it('computes each metric on the windowed series', () => {
    expect(windowedMetricValue('roi', ALPHA, ALPHA.monthlyReturns)).toBe(6.11);
    // mean 0.02, sample stdev 0.01 -> 2 * sqrt(12).
    expect(windowedMetricValue('sharpe', ALPHA, ALPHA.monthlyReturns)).toBe(6.9282);
    // No losing month, so the Sortino leg falls back to the Sharpe ratio.
    expect(windowedMetricValue('sortino', ALPHA, ALPHA.monthlyReturns)).toBe(6.9282);
    expect(windowedMetricValue('winRate', ALPHA, ALPHA.monthlyReturns)).toBe(60);
    expect(windowedMetricValue('consistency', ALPHA, ALPHA.monthlyReturns)).toBe(95.11);
    // mean 0.02, downside deviation 0.02 / sqrt(3) -> sqrt(3) * sqrt(12) = 6.
    expect(windowedMetricValue('sortino', BETA, BETA.monthlyReturns)).toBe(6);
    // mean 0.04 / 3, downside 0.01 / sqrt(3) -> exactly 8.
    expect(windowedMetricValue('sortino', GAMMA, GAMMA.monthlyReturns)).toBe(8);
    // mean 0.07 / 3, sample stdev sqrt(8 / 37500) -> exactly 3.5.
    expect(windowedMetricValue('sharpe', DELTA, DELTA.monthlyReturns)).toBe(3.5);
  });

  it('scores consistency on the window, not on the whole record', () => {
    // beta: 2/3 positive, 13.86% annualised vol, worst month -2%.
    expect(windowedMetricValue('consistency', BETA, BETA.monthlyReturns)).toBe(66.12);
    expect(windowedMetricValue('consistency', GAMMA, GAMMA.monthlyReturns)).toBe(72.4);
    expect(windowedMetricValue('consistency', DELTA, DELTA.monthlyReturns)).toBe(91.33);
    expect(windowedMetricValue('consistency', ALPHA, [])).toBe(0);
  });

  it('floors the Calmar denominator at a 1% drawdown', () => {
    const flat = boardProfile('flat', { returns: [0.02, 0.02, 0.02] });
    const [row] = buildLeaderboard([flat], { metric: 'calmar' });
    // (1.02^12 - 1) / 0.01 with a zero observed drawdown.
    expect(row.maxDrawdownPct).toBe(0);
    expect(row.calmar).toBe(26.8242);
    expect(row.sharpe).toBe(0);
    expect(row.sortino).toBe(0);
  });
});

describe('ranking', () => {
  it('orders the ROI board by windowed compounded return', () => {
    const board = buildLeaderboard(ALL, { window: 'all', minTenureMonths: 3 });
    expect(board.map((e) => [e.rank, e.traderId, e.roiPct])).toEqual([
      [1, 'zeta', 10.89],
      [2, 'delta', 7.11],
      [3, 'alpha', 6.11],
      [4, 'beta', 5.96],
      [5, 'gamma', 3.99],
    ]);
    expect(board.map((e) => e.metric)).toEqual(['roi', 'roi', 'roi', 'roi', 'roi']);
  });

  it('re-ranks the same traders on a risk-adjusted metric', () => {
    const board = buildLeaderboard(ALL, { metric: 'sharpe', window: 'all', minTenureMonths: 3 });
    expect(board.map((e) => e.traderId)).toEqual(['alpha', 'delta', 'gamma', 'beta', 'zeta']);
    expect(board.map((e) => e.metricValue)).toEqual([6.9282, 3.5, 1.8353, 1.7321, 1.4226]);
  });

  it('ranks win rate boards on settled deals', () => {
    const board = buildLeaderboard(ALL, { metric: 'winRate', window: 'all', minTenureMonths: 3 });
    expect(board.map((e) => [e.traderId, e.metricValue])).toEqual([
      ['delta', 100],
      ['gamma', 75],
      ['alpha', 60],
      ['beta', 50],
      ['zeta', 40],
    ]);
  });

  it('ranks consistency boards on the window', () => {
    const board = buildLeaderboard(ALL, { metric: 'consistency', window: 'all', minTenureMonths: 3 });
    expect(board.map((e) => e.traderId)).toEqual(['alpha', 'delta', 'gamma', 'beta', 'zeta']);
  });

  it('applies the documented five-level tie-break', () => {
    const sameMetric = [
      boardProfile('t-b', { returns: [0.01, 0.02, 0.03], tenureMonths: 24, aumUsd: 100_000 }),
      boardProfile('t-a', { returns: [0.01, 0.02, 0.03], tenureMonths: 24, aumUsd: 100_000 }),
    ];
    expect(buildLeaderboard(sameMetric).map((e) => e.traderId)).toEqual(['t-a', 't-b']);

    // Metric tie, different absolute ROI: the higher ROI wins (metric value ignored).
    const a = boardProfile('a', { returns: [0.01, 0.02, 0.03] });
    const b = boardProfile('b', { returns: [0.01, 0.02, 0.03] });
    const rows: LeaderboardEntry[] = [
      { ...row(a), metricValue: 1, roiPct: 5 },
      { ...row(b), metricValue: 1, roiPct: 7 },
    ];
    expect(rows.sort(compareEntries).map((e) => e.traderId)).toEqual(['b', 'a']);

    // Metric and ROI tie: the deeper AUM wins.
    const shallow = { ...row(a), metricValue: 1, roiPct: 5, aumUsd: 1000 };
    const deep = { ...row(a), metricValue: 1, roiPct: 5, aumUsd: 2000 };
    expect([shallow, deep].sort(compareEntries).map((e) => e.aumUsd)).toEqual([2000, 1000]);

    // AUM tie: the longer record wins.
    const junior = { ...row(a), metricValue: 1, roiPct: 5, aumUsd: 1000, tenureMonths: 6 };
    const senior = { ...row(a), metricValue: 1, roiPct: 5, aumUsd: 1000, tenureMonths: 60 };
    expect([junior, senior].sort(compareEntries).map((e) => e.tenureMonths)).toEqual([60, 6]);
  });

  it('honours the limit after ranking', () => {
    const board = buildLeaderboard(ALL, { window: 'all', limit: 2 });
    expect(board.map((e) => e.traderId)).toEqual(['zeta', 'delta']);
    // Badges use the full five-row board, so rank 2 lands in the Gold band.
    expect(board.map((e) => e.tierBadge)).toEqual(['Platinum', 'Gold']);
  });
});

function row(profile: TraderProfile): LeaderboardEntry {
  return buildLeaderboard([profile])[0];
}

describe('eligibility', () => {
  it('filters on tenure, assets, region and an empty record', () => {
    expect(DEFAULT_LEADERBOARD_RULES).toEqual({
      minTenureMonths: 3,
      minAumUsd: 0,
      limit: 50,
      tierCutoffs: { platinum: 0.15, gold: 0.4, silver: 0.7 },
    });
    expect(isEligible(ALPHA, {})).toBe(true);
    expect(isEligible(ZETA, { minTenureMonths: 6 })).toBe(false);
    expect(isEligible(GAMMA, { minAumUsd: 100_000 })).toBe(false);
    expect(isEligible(boardProfile('ghost', { returns: [], tenureMonths: 40 }), {})).toBe(false);
    expect(isEligible(ALPHA, { region: 'kenya' })).toBe(true);
    expect(isEligible(ALPHA, { region: 'all' })).toBe(true);
    expect(isEligible(ALPHA, { region: 'Ghana' })).toBe(false);
  });

  it('applies the filters before the limit is taken', () => {
    const board = buildLeaderboard(ALL, { window: 'all', region: 'Kenya', limit: 10 });
    expect(board.map((e) => e.traderId)).toEqual(['alpha', 'gamma']);
    expect(board[0].region).toBe('Kenya');
    expect(board[1].rank).toBe(2);
  });

  it('drops traders below the default three-month tenure', () => {
    const board = buildLeaderboard([boardProfile('newbie', { returns: [0.1], tenureMonths: 1 }), ALPHA]);
    expect(board.map((e) => e.traderId)).toEqual(['alpha']);
  });
});

describe('tier badges', () => {
  it('cuts the sorted board on percentiles', () => {
    expect(tierBadgeFor(0, 1)).toBe('Platinum');
    expect(tierBadgeFor(0, 8)).toBe('Platinum');
    expect(tierBadgeFor(1, 8)).toBe('Platinum');
    expect(tierBadgeFor(2, 8)).toBe('Gold');
    expect(tierBadgeFor(3, 8)).toBe('Gold');
    expect(tierBadgeFor(4, 8)).toBe('Silver');
    expect(tierBadgeFor(5, 8)).toBe('Silver');
    expect(tierBadgeFor(6, 8)).toBe('Bronze');
    expect(tierBadgeFor(7, 8)).toBe('Bronze');
    expect(tierBadgeFor(1, 4)).toBe('Gold');
    expect(tierBadgeFor(3, 4)).toBe('Bronze');
  });

  it('assigns a badge per finished rank', () => {
    const profiles = Array.from({ length: 8 }, (_, i) =>
      boardProfile(`p${i}`, { returns: [(i + 1) / 100, 0.01, 0.01] }),
    );
    const board = buildLeaderboard(profiles);
    expect(board.map((e) => e.tierBadge)).toEqual([
      'Platinum',
      'Platinum',
      'Gold',
      'Gold',
      'Silver',
      'Silver',
      'Bronze',
      'Bronze',
    ]);
  });
});

describe('risk join and summaries', () => {
  it('attaches supplied risk scores and tiers', () => {
    const board = buildLeaderboard([ALPHA, BETA], {
      window: 'all',
      riskScores: { alpha: { score: 71.5, tier: 'high' } },
    });
    expect(board.find((e) => e.traderId === 'alpha')).toMatchObject({ riskScore: 71.5, riskTier: 'high' });
    expect(board.find((e) => e.traderId === 'beta')).toMatchObject({ riskScore: null, riskTier: null });
    expect(riskTierSummary(board)).toEqual({ low: 0, moderate: 0, elevated: 0, high: 1 });
  });

  it('counts every tier present on the board', () => {
    const board = buildLeaderboard([ALPHA, BETA, GAMMA, DELTA], {
      window: 'all',
      riskScores: {
        alpha: { score: 10, tier: 'low' },
        beta: { score: 30, tier: 'moderate' },
        gamma: { score: 50, tier: 'elevated' },
        delta: { score: 80, tier: 'high' },
      },
    });
    expect(riskTierSummary(board)).toEqual({ low: 1, moderate: 1, elevated: 1, high: 1 });
    expect(riskTierSummary([])).toEqual({ low: 0, moderate: 0, elevated: 0, high: 0 });
  });
});

describe('sample data integration', () => {
  const profiles = buildSampleProfiles();

  it('ranks the seeded traders by trailing-year ROI', () => {
    const board = buildLeaderboard(profiles, { window: '12m' });
    expect(board.map((e) => e.traderId)).toEqual([
      'trader-koji',
      'trader-chidi',
      'trader-amina',
      'trader-ife',
      'trader-marta',
      'trader-ba',
      'trader-tunde',
      'trader-ravi',
    ]);
    expect(board.map((e) => e.roiPct)).toEqual([
      53.14, 20.24, 16.17, 14.5, 12.57, 11.96, -1.27, -13.43,
    ]);
    expect(board[0]).toMatchObject({ rank: 1, tierBadge: 'Platinum', windowLabel: 'Last 12 months' });
    expect(board[7].roiPct).toBeLessThan(0);
  });

  it('re-ranks on a short window and a different metric', () => {
    const board = buildLeaderboard(profiles, { metric: 'sharpe', window: '3m' });
    expect(board[0].traderId).toBe('trader-amina');
    expect(board[0].metricValue).toBe(18.8121);
    expect(board[0].windowLabel).toBe('Last 3 months');
    expect(board.every((e) => e.metric === 'sharpe')).toBe(true);
    expect(board.map((e) => e.metricValue)).toEqual(
      [...board.map((e) => e.metricValue)].sort((a, b) => b - a),
    );
  });

  it('exposes sparklines and trends for every seeded trader', () => {
    const board = buildLeaderboard(profiles, { window: 'all' });
    expect(board.every((e) => e.sparkline.length > 1)).toBe(true);
    expect(board.every((e) => Number.isFinite(e.trendPct))).toBe(true);
    expect(board.every((e) => e.maxDrawdownPct >= 0)).toBe(true);
    expect(board.every((e) => e.riskScore === null && e.riskTier === null)).toBe(true);
  });
});
