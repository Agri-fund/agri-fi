import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ATTRIBUTION_GROUP,
  aggregate,
  compareCopyVsOrganic,
  emptyStats,
  holdingDays,
  median,
  pearson,
  recordCopyResult,
  recordCopyResults,
  slippagePct,
} from '../copy-analytics';
import {
  DEMO_FOLLOWER_ID,
  SAMPLE_COPY_RESULTS,
  SAMPLE_ORGANIC_RESULTS,
} from '../sample-data';
import type { CopyResult } from '../types';

function result(overrides: Partial<CopyResult> = {}): CopyResult {
  return {
    copyId: 'r-1',
    configId: 'cfg1',
    followerId: 'f1',
    traderId: 't1',
    dealId: 'deal-1',
    commodity: 'Cocoa',
    region: 'West Africa',
    amountUsd: 1000,
    feeUsd: 3,
    openedAt: '2026-01-01T00:00:00.000Z',
    closedAt: '2026-02-01T00:00:00.000Z',
    monthKey: '2026-01',
    followerReturnPct: 5,
    leaderReturnPct: 4,
    leaderEntryPrice: 100,
    followerEntryPrice: 101,
    pnlUsd: 50,
    ...overrides,
  };
}

describe('stat primitives', () => {
  it('takes the middle value and averages the middle pair', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
    expect(median([])).toBe(0);
  });

  it('computes Pearson correlation', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBe(1);
    expect(pearson([1, 2, 3], [-1, -2, -3])).toBe(-1);
    // cov = 2, var x = 2, var y = 2 -> 2 / sqrt(4) = 1 with a lagged series.
    expect(pearson([1, 2, 3], [1, 2, 3])).toBe(1);
    expect(pearson([1, 2, 3], [0, 0, 0])).toBe(0);
    expect(pearson([1], [1])).toBe(0);
    expect(pearson([], [])).toBe(0);
    // Only the first min(n) pairs are compared.
    expect(pearson([0, 1, 5], [0, 1])).toBe(1);
  });

  it('measures entry slippage against the leader fill', () => {
    expect(slippagePct(result())).toBe(1);
    expect(slippagePct(result({ leaderEntryPrice: 80, followerEntryPrice: 81 }))).toBe(1.25);
    expect(slippagePct(result({ leaderEntryPrice: 0, followerEntryPrice: 10 }))).toBe(0);
    expect(slippagePct(result({ leaderEntryPrice: Number.NaN }))).toBe(0);
  });

  it('counts whole days held', () => {
    expect(holdingDays(result())).toBe(31);
    expect(holdingDays(result({ openedAt: '2026-01-01', closedAt: '2026-01-11' }))).toBe(10);
    expect(holdingDays(result({ closedAt: '2025-12-31T00:00:00.000Z' }))).toBe(0);
    expect(holdingDays(result({ closedAt: 'nonsense' }))).toBe(0);
  });
});

describe('recordCopyResult', () => {
  it('appends a new settled copy', () => {
    const next = recordCopyResult([], result());
    expect(next).toHaveLength(1);
    expect(next[0].copyId).toBe('r-1');
  });

  it('replaces a re-recorded copy id instead of duplicating it', () => {
    const once = recordCopyResult([], result());
    const twice = recordCopyResult(once, result({ pnlUsd: 80, followerReturnPct: 8 }));
    expect(twice).toHaveLength(1);
    expect(twice[0].pnlUsd).toBe(80);
    expect(once[0].pnlUsd).toBe(50);
  });

  it('folds a batch of results through the same dedupe rule', () => {
    const batch = recordCopyResults(
      [result()],
      [result({ copyId: 'r-2' }), result({ copyId: 'r-1', pnlUsd: 60 })],
    );
    expect(batch.map((r) => r.copyId)).toEqual(['r-1', 'r-2']);
    expect(batch[0].pnlUsd).toBe(60);
  });
});

describe('aggregate', () => {
  it('returns an inert stats object for no history', () => {
    const stats = emptyStats('f1');
    expect(stats).toMatchObject({
      followerId: 'f1',
      totalCopies: 0,
      successfulCopies: 0,
      successRatePct: 0,
      beatLeaderRatePct: 0,
      avgReturnPct: 0,
      medianReturnPct: 0,
      avgWinPct: 0,
      avgLossPct: 0,
      avgSlippagePct: 0,
      worstSlippagePct: 0,
      fidelity: 0,
      trackingErrorPct: 0,
      totalPnlUsd: 0,
      grossProfitUsd: 0,
      grossLossUsd: 0,
      profitFactor: null,
      totalFeesUsd: 0,
      avgHoldingDays: 0,
      bestCopy: null,
      worstCopy: null,
    });
    expect(stats.monthly).toEqual([]);
    expect(stats.attribution).toEqual([]);
  });

  it('splits wins, losses and the profit factor', () => {
    const stats = aggregate([
      result({ copyId: 'a', followerReturnPct: 10, pnlUsd: 100, feeUsd: 3 }),
      result({ copyId: 'b', followerReturnPct: 2, pnlUsd: 20, feeUsd: 3 }),
      result({ copyId: 'c', followerReturnPct: -5, pnlUsd: -50, feeUsd: 3 }),
    ]);
    expect(stats.totalCopies).toBe(3);
    expect(stats.successfulCopies).toBe(2);
    expect(stats.successRatePct).toBe(66.67);
    expect(stats.avgReturnPct).toBe(2.33);
    expect(stats.medianReturnPct).toBe(2);
    expect(stats.avgWinPct).toBe(6);
    expect(stats.avgLossPct).toBe(-5);
    expect(stats.totalPnlUsd).toBe(70);
    expect(stats.grossProfitUsd).toBe(120);
    expect(stats.grossLossUsd).toBe(50);
    expect(stats.profitFactor).toBe(2.4);
    expect(stats.totalFeesUsd).toBe(9);
  });

  it('reports a null profit factor when nothing lost money', () => {
    expect(aggregate([result({ followerReturnPct: 1, pnlUsd: 10 })]).profitFactor).toBeNull();
  });

  it('treats a break-even copy as neither win nor loss', () => {
    const stats = aggregate([result({ followerReturnPct: 0, leaderReturnPct: 0, pnlUsd: 0 })]);
    expect(stats.successfulCopies).toBe(0);
    expect(stats.avgWinPct).toBe(0);
    expect(stats.avgLossPct).toBe(0);
    // A flat follower return still counts as matching the flat leader return.
    expect(stats.beatLeaderRatePct).toBe(100);
  });

  it('tracks fidelity and tracking error against the leader', () => {
    const stats = aggregate([
      result({ copyId: 'a', followerReturnPct: 4, leaderReturnPct: 5 }),
      result({ copyId: 'b', followerReturnPct: 0, leaderReturnPct: 1 }),
      result({ copyId: 'c', followerReturnPct: 6, leaderReturnPct: 7 }),
    ]);
    // follower = leader - 1 everywhere: perfect correlation, zero tracking error.
    expect(stats.fidelity).toBe(1);
    expect(stats.trackingErrorPct).toBe(0);
    expect(stats.beatLeaderRatePct).toBe(0);
  });

  it('falls back to zero fidelity when one series is flat', () => {
    const stats = aggregate([
      result({ copyId: 'a', followerReturnPct: 3, leaderReturnPct: 1 }),
      result({ copyId: 'b', followerReturnPct: 3, leaderReturnPct: 2 }),
    ]);
    expect(stats.fidelity).toBe(0);
    // diffs 2 and 1 -> sample stdev of [2, 1] = 0.7071.
    expect(stats.trackingErrorPct).toBe(0.71);
  });

  it('picks the best and worst copies by follower return', () => {
    const stats = aggregate([
      result({ copyId: 'hi', followerReturnPct: 9 }),
      result({ copyId: 'lo', followerReturnPct: -9 }),
      result({ copyId: 'mid', followerReturnPct: 0 }),
    ]);
    expect(stats.bestCopy?.copyId).toBe('hi');
    expect(stats.worstCopy?.copyId).toBe('lo');
  });

  it('buckets monthly performance in calendar order', () => {
    const stats = aggregate([
      result({ copyId: 'a', monthKey: '2026-02', followerReturnPct: 4, pnlUsd: 40 }),
      result({ copyId: 'b', monthKey: '2026-01', followerReturnPct: -2, pnlUsd: -20 }),
      result({ copyId: 'c', monthKey: '2026-01', followerReturnPct: 6, pnlUsd: 60 }),
    ]);
    expect(stats.monthly).toEqual([
      { monthKey: '2026-01', copies: 2, successRatePct: 50, avgReturnPct: 2, pnlUsd: 40 },
      { monthKey: '2026-02', copies: 1, successRatePct: 100, avgReturnPct: 4, pnlUsd: 40 },
    ]);
  });

  it('attributes profit by trader, commodity and region', () => {
    const results = [
      result({ copyId: 'a', traderId: 't1', commodity: 'Cocoa', region: 'West Africa', pnlUsd: 100, amountUsd: 1000, followerReturnPct: 10 }),
      result({ copyId: 'b', traderId: 't2', commodity: 'Cocoa', region: 'West Africa', pnlUsd: -40, amountUsd: 800, followerReturnPct: -5 }),
      result({ copyId: 'c', traderId: 't2', commodity: 'Coffee', region: 'East Africa', pnlUsd: 20, amountUsd: 200, followerReturnPct: 10 }),
    ];
    expect(DEFAULT_ATTRIBUTION_GROUP).toBe('trader');
    expect(aggregate(results).attribution).toEqual([
      { key: 't1', label: 't1', copies: 1, deployedUsd: 1000, pnlUsd: 100, contributionPct: 62.5, avgReturnPct: 10 },
      { key: 't2', label: 't2', copies: 2, deployedUsd: 1000, pnlUsd: -20, contributionPct: 12.5, avgReturnPct: 2.5 },
    ]);
    expect(aggregate(results, { attributionGroup: 'commodity' }).attribution.map((a) => [a.key, a.pnlUsd])).toEqual([
      ['Cocoa', 60],
      ['Coffee', 20],
    ]);
    expect(aggregate(results, { attributionGroup: 'region' }).attribution.map((a) => a.key)).toEqual([
      'West Africa',
      'East Africa',
    ]);
  });

  it('scales contribution by absolute profit', () => {
    const stats = aggregate([
      result({ copyId: 'a', pnlUsd: 50, followerReturnPct: 5 }),
      result({ copyId: 'b', pnlUsd: -50, followerReturnPct: -5, traderId: 't2' }),
    ]);
    // Equal magnitude losses and gains split the 100 of absolute P&L evenly.
    expect(stats.attribution.map((a) => a.contributionPct)).toEqual([50, 50]);
  });

  it('uses the explicit follower id when supplied', () => {
    expect(aggregate([result()], { followerId: 'me' }).followerId).toBe('me');
    expect(aggregate([result({ followerId: 'them' })]).followerId).toBe('them');
  });
});

describe('sample copy history', () => {
  const stats = aggregate(SAMPLE_COPY_RESULTS, { followerId: DEMO_FOLLOWER_ID });

  it('aggregates the seeded copies to fixed numbers', () => {
    expect(stats.followerId).toBe(DEMO_FOLLOWER_ID);
    expect(stats.totalCopies).toBe(5);
    expect(stats.successfulCopies).toBe(3);
    expect(stats.successRatePct).toBe(60);
    expect(stats.beatLeaderRatePct).toBe(20);
    expect(stats.avgReturnPct).toBe(2.41);
    expect(stats.medianReturnPct).toBe(3.1);
    expect(stats.avgWinPct).toBe(5.25);
    expect(stats.avgLossPct).toBe(-1.85);
    expect(stats.avgSlippagePct).toBe(0.92);
    expect(stats.worstSlippagePct).toBe(1.43);
    expect(stats.fidelity).toBe(0.987);
    expect(stats.trackingErrorPct).toBe(0.77);
    expect(stats.totalPnlUsd).toBe(190.6);
    expect(stats.grossProfitUsd).toBe(229.6);
    expect(stats.grossLossUsd).toBe(39);
    expect(stats.profitFactor).toBe(5.89);
    expect(stats.totalFeesUsd).toBe(19.05);
    expect(stats.avgHoldingDays).toBe(22.8);
    expect(stats.bestCopy?.copyId).toBe('copyres-1');
    expect(stats.worstCopy?.copyId).toBe('copyres-3');
  });

  it('breaks the seeded copies down by month and commodity', () => {
    expect(stats.monthly).toEqual([
      { monthKey: '2026-06', copies: 1, successRatePct: 100, avgReturnPct: 7.25, pnlUsd: 139 },
      { monthKey: '2026-07', copies: 2, successRatePct: 50, avgReturnPct: 0.3, pnlUsd: 12 },
      { monthKey: '2026-08', copies: 1, successRatePct: 100, avgReturnPct: 5.4, pnlUsd: 48.6 },
      { monthKey: '2026-09', copies: 1, successRatePct: 0, avgReturnPct: -1.2, pnlUsd: -9 },
    ]);
    expect(stats.attribution).toEqual([
      { key: 'trader-amina', label: 'trader-amina', copies: 5, deployedUsd: 6350, pnlUsd: 190.6, contributionPct: 70.96, avgReturnPct: 2.41 },
    ]);
    const byCommodity = aggregate(SAMPLE_COPY_RESULTS, { attributionGroup: 'commodity' }).attribution;
    expect(byCommodity.map((a) => [a.key, a.pnlUsd, a.contributionPct])).toEqual([
      ['Cocoa', 229.6, 85.48],
      ['Sesame', -9, 3.35],
      ['Cashew', -30, 11.17],
    ]);
  });
});

describe('compareCopyVsOrganic', () => {
  it('credits copying when it outperforms self-directed picks', () => {
    const comparison = compareCopyVsOrganic(SAMPLE_COPY_RESULTS, SAMPLE_ORGANIC_RESULTS, {
      followerId: DEMO_FOLLOWER_ID,
    });
    expect(comparison.copies.successRatePct).toBe(60);
    expect(comparison.organic.successRatePct).toBe(50);
    expect(comparison.organic.avgReturnPct).toBe(-1.2);
    expect(comparison.organic.totalPnlUsd).toBe(-49.5);
    expect(comparison.organic.profitFactor).toBe(0.56);
    expect(comparison.organic.fidelity).toBe(1);
    expect(comparison.successRateDeltaPct).toBe(10);
    expect(comparison.avgReturnDeltaPct).toBe(3.61);
    expect(comparison.pnlDeltaUsd).toBe(240.1);
    expect(comparison.verdict).toBe('copying_ahead');
    expect(comparison.summary).toBe(
      'Copying beat self-directed picks by 10 percentage points of success rate and 3.61 points of average return.',
    );
  });

  it('calls out copying when it lags and stays neutral inside the band', () => {
    const copies = [result({ copyId: 'c1', followerReturnPct: -1, leaderReturnPct: 3, pnlUsd: -10 })];
    const organic = [
      result({ copyId: 'o1', followerReturnPct: 4, leaderReturnPct: 4, pnlUsd: 40 }),
      result({ copyId: 'o2', followerReturnPct: 6, leaderReturnPct: 6, pnlUsd: 60 }),
    ];
    const behind = compareCopyVsOrganic(copies, organic);
    expect(behind.successRateDeltaPct).toBe(-100);
    expect(behind.avgReturnDeltaPct).toBe(-6);
    expect(behind.pnlDeltaUsd).toBe(-110);
    expect(behind.verdict).toBe('copying_behind');
    expect(behind.summary).toContain('trailed self-directed picks by 100');

    const even = compareCopyVsOrganic(
      [result({ copyId: 'c1', followerReturnPct: 5, pnlUsd: 50 })],
      [result({ copyId: 'o1', followerReturnPct: 5.2, pnlUsd: 52 })],
    );
    expect(even.successRateDeltaPct).toBe(0);
    expect(even.avgReturnDeltaPct).toBe(-0.2);
    expect(even.verdict).toBe('even');
    expect(even.summary).toBe(
      'Copying and self-directed picks performed within half a percentage point of each other.',
    );
  });

  it('handles two empty ledgers', () => {
    const comparison = compareCopyVsOrganic([], [], { followerId: 'f1' });
    expect(comparison.verdict).toBe('even');
    expect(comparison.pnlDeltaUsd).toBe(0);
    expect(comparison.copies.followerId).toBe('f1');
  });
});
