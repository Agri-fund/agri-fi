/**
 * Trader profile construction and risk-adjusted performance math (issue #1212).
 *
 * Conventions (see `frontend/docs/social-trading.md`):
 *  - Return series are monthly and expressed as decimal fractions (0.015 = 1.5%).
 *  - Dispersion uses the *sample* standard deviation, i.e. division by (n - 1).
 *  - Annualisation multiplies a monthly mean by 12 for ratios (Sharpe/Sortino) and
 *    compounds the equity multiple for absolute returns.
 *  - Drawdown is reported as a positive magnitude.
 */

import type { Deal, Investment } from '@/lib/api';
import type {
  PerformanceMetrics,
  PerformancePoint,
  SectorExposure,
  SocialMetricWindow,
  TraderIdentity,
  TraderProfile,
} from './types';

export const MONTHS_PER_YEAR = 12;
/** Annualised volatility at or above which a trader scores 0 on the volatility leg. */
export const MAX_ANNUAL_VOLATILITY = 0.3;
/** Worst monthly return magnitude at or above which the tail leg scores 0. */
export const MAX_WORST_MONTH = 0.1;
export const CONSISTENCY_WEIGHTS = {
  positiveMonths: 0.55,
  volatility: 0.25,
  worstMonth: 0.2,
} as const;

const WINDOW_MONTHS: Record<SocialMetricWindow, number> = {
  '1m': 1,
  '3m': 3,
  '6m': 6,
  '12m': 12,
  all: Number.POSITIVE_INFINITY,
};

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Sample standard deviation (n - 1 denominator); 0 when fewer than two points. */
export function sampleStandardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance =
    values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Sortino downside deviation: RMS of shortfalls against a 0% MAR over all periods. */
export function downsideDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const squared = values.reduce((sum, v) => sum + Math.min(v, 0) ** 2, 0);
  return Math.sqrt(squared / values.length);
}

export function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function compoundReturn(returns: number[]): number {
  return (
    returns.reduce((multiple, r) => multiple * (1 + r), 1) - 1
  );
}

/** Geometric annualisation of a monthly series: (1 + total)^(12/n) - 1. */
export function annualizeReturn(returns: number[]): number {
  if (returns.length === 0) return 0;
  const total = compoundReturn(returns);
  return (1 + total) ** (MONTHS_PER_YEAR / returns.length) - 1;
}

/** Monthly risk-free rate from an annual rate, compounded: (1 + rf)^(1/12) - 1. */
export function monthlyRiskFreeRate(annualRate: number): number {
  return (1 + annualRate) ** (1 / MONTHS_PER_YEAR) - 1;
}

export interface RiskAdjustedMetrics {
  sharpe: number;
  sortino: number;
  calmar: number;
  maxDrawdown: number;
  volatility: number;
}

/** Peak-to-trough decline of the compounded equity curve, positive magnitude. */
export function computeMaxDrawdown(returns: number[]): number {
  let peak = 1;
  let equity = 1;
  let maxDrawdown = 0;
  for (const r of returns) {
    equity *= 1 + r;
    if (equity > peak) peak = equity;
    if (peak > 0) {
      const drawdown = (peak - equity) / peak;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
  }
  return maxDrawdown;
}

export function computeRiskAdjustedMetrics(
  returns: number[],
  riskFreeAnnual = 0,
): RiskAdjustedMetrics {
  const clean = returns.filter((r) => Number.isFinite(r));
  if (clean.length === 0) {
    return { sharpe: 0, sortino: 0, calmar: 0, maxDrawdown: 0, volatility: 0 };
  }

  const rfMonthly = monthlyRiskFreeRate(riskFreeAnnual);
  const excess = mean(clean) - rfMonthly;
  const stdev = sampleStandardDeviation(clean);
  const downside = downsideDeviation(clean);
  const maxDrawdown = computeMaxDrawdown(clean);
  const volatility = stdev * Math.sqrt(MONTHS_PER_YEAR);

  const sharpe = stdev > 0 ? excess / stdev * Math.sqrt(MONTHS_PER_YEAR) : 0;
  // A window with no losing periods has zero downside deviation; reporting the
  // symmetric Sharpe there keeps the ratio finite and never flatters the trader.
  const sortino =
    downside > 0 ? (excess / downside) * Math.sqrt(MONTHS_PER_YEAR) : excess > 0 ? sharpe : 0;
  // Calmar divides by a 1% drawdown floor: traders with a near-flat curve would
  // otherwise produce enormous (or infinite) ratios that dominate the leaderboard.
  const calmar = annualizeReturn(clean) / Math.max(maxDrawdown, 0.01);

  return {
    sharpe: round(sharpe),
    sortino: round(sortino),
    calmar: round(calmar),
    maxDrawdown: round(maxDrawdown),
    volatility: round(volatility),
  };
}

export function windowReturns(
  returns: number[],
  window: SocialMetricWindow,
): number[] {
  const months = WINDOW_MONTHS[window];
  if (!Number.isFinite(months) || returns.length <= months) return [...returns];
  return returns.slice(returns.length - months);
}

/** Builds the monthly cumulative series; `firstPeriod` is `YYYY-MM`. */
export function buildPerformanceHistory(
  returns: number[],
  firstPeriod: string,
): PerformancePoint[] {
  const points: PerformancePoint[] = [];
  let equity = 1;
  returns.forEach((r, index) => {
    equity *= 1 + r;
    points.push({
      period: addMonths(firstPeriod, index),
      returnPct: round(r * 100, 2),
      cumulativePct: round((equity - 1) * 100, 2),
      equityIndex: round(equity * 100, 2),
    });
  });
  return points;
}

export function addMonths(period: string, months: number): string {
  const parsed = /^(\d{4})-(\d{2})$/.exec(period);
  if (!parsed) return period;
  const start = Number(parsed[1]) * 12 + (Number(parsed[2]) - 1) + months;
  const year = Math.floor(start / 12);
  const month = (start % 12 + 12) % 12;
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

export function currentPeriod(isoDate: string): string {
  const parsed = /^(\d{4})-(\d{2})/.exec(isoDate);
  return parsed ? `${parsed[1]}-${parsed[2]}` : isoDate;
}

/** Whole calendar months between two ISO dates (truncating towards the start). */
export function monthsBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  let months =
    (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return Math.max(0, months);
}

export function computeConsistencyScore(returns: number[]): number {
  if (returns.length === 0) return 0;
  const positiveRate =
    returns.filter((r) => r > 0).length / returns.length;
  const volatility =
    sampleStandardDeviation(returns) * Math.sqrt(MONTHS_PER_YEAR);
  const worst = Math.min(...returns);
  const volatilityLeg = 1 - Math.min(Math.abs(volatility) / MAX_ANNUAL_VOLATILITY, 1);
  const tailLeg = 1 - Math.min(Math.abs(worst) / MAX_WORST_MONTH, 1);
  const raw =
    CONSISTENCY_WEIGHTS.positiveMonths * positiveRate +
    CONSISTENCY_WEIGHTS.volatility * volatilityLeg +
    CONSISTENCY_WEIGHTS.worstMonth * tailLeg;
  return round(Math.max(0, Math.min(1, raw)) * 100, 2);
}

/** Value-weighted commodity exposure of a set of investments. */
export function computeExposures(investments: Investment[]): SectorExposure[] {
  const deployed = new Map<string, number>();
  let total = 0;
  for (const investment of investments) {
    const sector = investment.deal?.commodity ?? 'Unknown';
    const amount = investment.amount_invested || investment.amount_usd || 0;
    if (amount <= 0) continue;
    deployed.set(sector, (deployed.get(sector) ?? 0) + amount);
    total += amount;
  }
  if (total <= 0) return [];
  const rows: SectorExposure[] = [];
  deployed.forEach((usd, sector) => {
    rows.push({ sector, sharePct: round((usd / total) * 100, 2), deployedUsd: round(usd, 2) });
  });
  return rows.sort((a, b) => b.sharePct - a.sharePct || a.sector.localeCompare(b.sector));
}

export function dealDefaultRatePct(deals: Deal[]): number {
  if (deals.length === 0) return 0;
  const failed = deals.filter((d) => d.status === 'failed').length;
  return round((failed / deals.length) * 100, 2);
}

/** Settled investments carry a realised return percentage. */
export function isSettled(investment: Investment): boolean {
  return investment.return_percentage !== null && investment.return_percentage !== undefined;
}

function holdingDays(investment: Investment): number | null {
  const start = new Date(investment.created_at).getTime();
  const end = new Date(investment.deal?.delivery_date ?? '').getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 86_400_000);
}

export function computeMetrics(
  monthlyReturns: number[],
  investments: Investment[],
  deals: Deal[],
  options: { asOf?: string; joinedAt?: string; riskFreeAnnual?: number } = {},
): PerformanceMetrics {
  const riskFreeAnnual = options.riskFreeAnnual ?? 0;
  const adjusted = computeRiskAdjustedMetrics(monthlyReturns, riskFreeAnnual);

  const settled = investments.filter(isSettled);
  const cost = settled.reduce(
    (sum, i) => sum + (i.amount_invested || i.amount_usd || 0),
    0,
  );
  const pnl = settled.reduce(
    (sum, i) =>
      sum +
      ((i.amount_invested || i.amount_usd || 0) * (i.return_percentage ?? 0)) / 100,
    0,
  );
  const wins = settled.filter((i) => (i.return_percentage ?? 0) > 0).length;

  const holdings = settled
    .map(holdingDays)
    .filter((d): d is number => d !== null);

  const realizedRoiPct = cost > 0 ? (pnl / cost) * 100 : 0;
  const exposures = computeExposures(investments);
  const bestMonth =
    monthlyReturns.length > 0 ? Math.max(...monthlyReturns) * 100 : 0;
  const worstMonth =
    monthlyReturns.length > 0 ? Math.min(...monthlyReturns) * 100 : 0;

  return {
    cumulativeReturnPct: round(compoundReturn(monthlyReturns) * 100, 2),
    realizedRoiPct: round(realizedRoiPct, 2),
    winRatePct: settled.length > 0 ? round((wins / settled.length) * 100, 2) : 0,
    avgHoldingDays:
      holdings.length > 0
        ? round(holdings.reduce((s, d) => s + d, 0) / holdings.length, 1)
        : 0,
    maxDrawdownPct: round(adjusted.maxDrawdown * 100, 2),
    sharpe: adjusted.sharpe,
    sortino: adjusted.sortino,
    calmar: adjusted.calmar,
    volatilityPct: round(adjusted.volatility * 100, 2),
    consistencyScore: computeConsistencyScore(monthlyReturns),
    bestPeriodPct: round(bestMonth, 2),
    worstPeriodPct: round(worstMonth, 2),
    positivePeriodRatePct:
      monthlyReturns.length > 0
        ? round(
            (monthlyReturns.filter((r) => r > 0).length / monthlyReturns.length) *
              100,
            2,
          )
        : 0,
    defaultRatePct: dealDefaultRatePct(deals),
    tenureMonths:
      options.joinedAt && options.asOf
        ? monthsBetween(options.joinedAt, options.asOf)
        : monthlyReturns.length,
    exposures,
    topExposurePct: exposures[0]?.sharePct ?? 0,
    annualizedReturnPct: round(annualizeReturn(monthlyReturns) * 100, 2),
    periodCount: monthlyReturns.length,
  };
}

export function buildSparkline(performance: PerformancePoint[]): number[] {
  return performance.map((p) => p.cumulativePct);
}

export function buildTraderProfile(
  trader: TraderIdentity,
  deals: Deal[],
  investments: Investment[],
  options: { asOf?: string; riskFreeAnnual?: number } = {},
): TraderProfile {
  const asOf = options.asOf ?? new Date().toISOString();
  const performance = buildPerformanceHistory(
    trader.monthlyReturns,
    trader.firstReturnPeriod,
  );
  const metrics = computeMetrics(trader.monthlyReturns, investments, deals, {
    asOf,
    joinedAt: trader.joinedAt,
    riskFreeAnnual: options.riskFreeAnnual,
  });

  return {
    traderId: trader.traderId,
    displayName: trader.displayName,
    avatarUrl: trader.avatarUrl ?? null,
    bio: trader.bio,
    strategySummary: trader.strategySummary,
    focusSectors: trader.focusSectors,
    regions: trader.regions,
    joinedAt: trader.joinedAt,
    verified: trader.verified,
    aumUsd: trader.aumUsd,
    followerCount: trader.followerCount,
    performance,
    sparkline: buildSparkline(performance),
    monthlyReturns: [...trader.monthlyReturns],
    firstReturnPeriod: trader.firstReturnPeriod,
    metrics,
    deals,
    investments,
  };
}
