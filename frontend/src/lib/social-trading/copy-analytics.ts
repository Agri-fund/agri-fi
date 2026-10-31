/**
 * Copy-trading analytics (issue #1212): success-rate tracking, copy fidelity,
 * entry slippage, PnL attribution and copy-vs-organic comparison.
 */

import { sampleStandardDeviation } from './profiles';
import type {
  CopyPerformanceStats,
  CopyResult,
  CopyVsOrganicComparison,
  PnlAttribution,
  CopyMonthBucket,
} from './types';

export type AttributionGroup = 'trader' | 'commodity' | 'region';

export const DEFAULT_ATTRIBUTION_GROUP: AttributionGroup = 'trader';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Appends a settled copy; re-recording the same `copyId` replaces it. */
export function recordCopyResult(
  results: CopyResult[],
  result: CopyResult,
): CopyResult[] {
  const index = results.findIndex((r) => r.copyId === result.copyId);
  if (index === -1) return [...results, result];
  const next = [...results];
  next[index] = result;
  return next;
}

export function recordCopyResults(
  results: CopyResult[],
  incoming: CopyResult[],
): CopyResult[] {
  return incoming.reduce((acc, result) => recordCopyResult(acc, result), results);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Pearson product-moment correlation; 0 when either series has no variance. */
export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = xs.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const my = ys.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx <= 0 || vy <= 0) return 0;
  return cov / Math.sqrt(vx * vy);
}

/** Entry slippage of the follower against the leader's fill, percentage points. */
export function slippagePct(result: CopyResult): number {
  if (!Number.isFinite(result.leaderEntryPrice) || result.leaderEntryPrice <= 0) return 0;
  return ((result.followerEntryPrice - result.leaderEntryPrice) / result.leaderEntryPrice) * 100;
}

export function holdingDays(result: CopyResult): number {
  const start = new Date(result.openedAt).getTime();
  const end = new Date(result.closedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / 86_400_000);
}

function groupKey(result: CopyResult, group: AttributionGroup): string {
  if (group === 'commodity') return result.commodity;
  if (group === 'region') return result.region;
  return result.traderId;
}

function groupLabel(result: CopyResult, group: AttributionGroup): string {
  return groupKey(result, group);
}

function buildAttribution(
  results: CopyResult[],
  group: AttributionGroup,
  absolutePnl: number,
): PnlAttribution[] {
  const buckets = new Map<string, { label: string; pnl: number; deployed: number; returns: number[] }>();
  for (const result of results) {
    const key = groupKey(result, group);
    const bucket = buckets.get(key) ?? {
      label: groupLabel(result, group),
      pnl: 0,
      deployed: 0,
      returns: [],
    };
    bucket.pnl += result.pnlUsd;
    bucket.deployed += result.amountUsd;
    bucket.returns.push(result.followerReturnPct);
    buckets.set(key, bucket);
  }

  const rows: PnlAttribution[] = [];
  buckets.forEach((bucket, key) => {
    rows.push({
      key,
      label: bucket.label,
      copies: bucket.returns.length,
      deployedUsd: round2(bucket.deployed),
      pnlUsd: round2(bucket.pnl),
      contributionPct:
        absolutePnl > 0 ? round2((Math.abs(bucket.pnl) / absolutePnl) * 100) : 0,
      avgReturnPct: round2(
        bucket.returns.reduce((s, v) => s + v, 0) / Math.max(1, bucket.returns.length),
      ),
    });
  });

  return rows.sort((a, b) => b.pnlUsd - a.pnlUsd || a.key.localeCompare(b.key));
}

function buildMonthly(results: CopyResult[]): CopyMonthBucket[] {
  const buckets = new Map<string, { copies: number; wins: number; returns: number[]; pnl: number }>();
  for (const result of results) {
    const bucket = buckets.get(result.monthKey) ?? { copies: 0, wins: 0, returns: [], pnl: 0 };
    bucket.copies += 1;
    if (result.followerReturnPct > 0) bucket.wins += 1;
    bucket.returns.push(result.followerReturnPct);
    bucket.pnl += result.pnlUsd;
    buckets.set(result.monthKey, bucket);
  }
  const rows: CopyMonthBucket[] = [];
  buckets.forEach((bucket, monthKey) => {
    rows.push({
      monthKey,
      copies: bucket.copies,
      successRatePct: round2((bucket.wins / Math.max(1, bucket.copies)) * 100),
      avgReturnPct: round2(
        bucket.returns.reduce((s, v) => s + v, 0) / Math.max(1, bucket.returns.length),
      ),
      pnlUsd: round2(bucket.pnl),
    });
  });
  return rows.sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}

export function aggregate(
  results: CopyResult[],
  options: { followerId?: string; attributionGroup?: AttributionGroup } = {},
): CopyPerformanceStats {
  const group = options.attributionGroup ?? DEFAULT_ATTRIBUTION_GROUP;
  const returns = results.map((r) => r.followerReturnPct);
  const leaderReturns = results.map((r) => r.leaderReturnPct);
  const wins = returns.filter((v) => v > 0);
  const losses = returns.filter((v) => v < 0);

  const totalPnl = results.reduce((s, r) => s + r.pnlUsd, 0);
  const grossProfit = results
    .filter((r) => r.pnlUsd > 0)
    .reduce((s, r) => s + r.pnlUsd, 0);
  // Losses are reported as a positive magnitude so `profitFactor` stays readable.
  const grossLoss = results
    .filter((r) => r.pnlUsd < 0)
    .reduce((s, r) => s - r.pnlUsd, 0);
  const absolutePnl = results.reduce((s, r) => s + Math.abs(r.pnlUsd), 0);

  const diffs = results.map((r) => r.followerReturnPct - r.leaderReturnPct);
  const slippages = results.map(slippagePct);
  const days = results.map(holdingDays);

  const sorted = [...results].sort(
    (a, b) =>
      b.followerReturnPct - a.followerReturnPct || a.copyId.localeCompare(b.copyId),
  );

  return {
    followerId: options.followerId ?? results[0]?.followerId ?? '',
    totalCopies: results.length,
    successfulCopies: wins.length,
    successRatePct: results.length > 0 ? round2((wins.length / results.length) * 100) : 0,
    beatLeaderRatePct:
      results.length > 0
        ? round2(
            (results.filter((r) => r.followerReturnPct >= r.leaderReturnPct).length /
              results.length) *
              100,
          )
        : 0,
    avgReturnPct: round2(returns.reduce((s, v) => s + v, 0) / Math.max(1, returns.length)),
    medianReturnPct: round2(median(returns)),
    avgWinPct: round2(wins.reduce((s, v) => s + v, 0) / Math.max(1, wins.length)),
    avgLossPct: round2(losses.reduce((s, v) => s + v, 0) / Math.max(1, losses.length)),
    avgSlippagePct: round2(slippages.reduce((s, v) => s + v, 0) / Math.max(1, slippages.length)),
    worstSlippagePct: round2(slippages.length > 0 ? Math.max(...slippages) : 0),
    fidelity: round4(pearson(returns, leaderReturns)),
    trackingErrorPct: round2(sampleStandardDeviation(diffs)),
    totalPnlUsd: round2(totalPnl),
    grossProfitUsd: round2(grossProfit),
    grossLossUsd: round2(grossLoss),
    profitFactor: grossLoss > 0 ? round2(grossProfit / grossLoss) : null,
    totalFeesUsd: round2(results.reduce((s, r) => s + r.feeUsd, 0)),
    avgHoldingDays: round2(days.reduce((s, v) => s + v, 0) / Math.max(1, days.length)),
    monthly: buildMonthly(results),
    attribution: buildAttribution(results, group, absolutePnl),
    bestCopy: sorted[0] ?? null,
    worstCopy: sorted.length > 0 ? sorted[sorted.length - 1] : null,
  };
}

export function emptyStats(followerId: string): CopyPerformanceStats {
  return aggregate([], { followerId });
}

export function compareCopyVsOrganic(
  copies: CopyResult[],
  organic: CopyResult[],
  options: { followerId?: string } = {},
): CopyVsOrganicComparison {
  const copyStats = aggregate(copies, options);
  const organicStats = aggregate(organic, options);

  const successRateDeltaPct = round2(
    copyStats.successRatePct - organicStats.successRatePct,
  );
  const avgReturnDeltaPct = round2(copyStats.avgReturnPct - organicStats.avgReturnPct);
  const pnlDeltaUsd = round2(copyStats.totalPnlUsd - organicStats.totalPnlUsd);

  const verdict: CopyVsOrganicComparison['verdict'] =
    successRateDeltaPct > 0.5 || avgReturnDeltaPct > 0.5
      ? 'copying_ahead'
      : successRateDeltaPct < -0.5 || avgReturnDeltaPct < -0.5
        ? 'copying_behind'
        : 'even';

  const summary =
    verdict === 'copying_ahead'
      ? `Copying beat self-directed picks by ${successRateDeltaPct} percentage points of success rate and ${avgReturnDeltaPct} points of average return.`
      : verdict === 'copying_behind'
        ? `Copying trailed self-directed picks by ${Math.abs(successRateDeltaPct)} percentage points of success rate and ${Math.abs(avgReturnDeltaPct)} points of average return.`
        : 'Copying and self-directed picks performed within half a percentage point of each other.';

  return {
    copies: copyStats,
    organic: organicStats,
    successRateDeltaPct,
    avgReturnDeltaPct,
    pnlDeltaUsd,
    verdict,
    summary,
  };
}
