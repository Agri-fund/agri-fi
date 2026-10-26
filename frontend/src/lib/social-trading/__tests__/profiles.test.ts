import { describe, expect, it } from 'vitest';
import {
  annualizeReturn,
  buildPerformanceHistory,
  buildTraderProfile,
  computeConsistencyScore,
  computeExposures,
  computeMaxDrawdown,
  computeRiskAdjustedMetrics,
  compoundReturn,
  dealDefaultRatePct,
  downsideDeviation,
  mean,
  monthsBetween,
  sampleStandardDeviation,
  windowReturns,
} from '@/lib/social-trading/profiles';
import { buildSampleProfiles, SAMPLE_AS_OF } from '@/lib/social-trading/sample-data';
import type { Deal, Investment } from '@/lib/api';

// A hand-checkable series: 1.1, 0.99, 1.089, 0.9801 on a $1 base.
const SWING = [0.1, -0.1, 0.1, -0.1];

function deal(overrides: Partial<Deal> & { id: string }): Deal {
  return {
    commodity: 'Cocoa',
    quantity: 100,
    quantity_unit: 'tonnes',
    total_value: 100_000,
    funded_amount: 100_000,
    total_invested: 100_000,
    token_count: 100,
    tokens_remaining: 0,
    token_symbol: 'COC',
    status: 'completed',
    delivery_date: '2026-04-30',
    created_at: '2026-01-31T00:00:00.000Z',
    ...overrides,
  };
}

function investment(
  id: string,
  d: Deal,
  amountInvested: number,
  returnPercentage: number | null,
  createdAt = '2026-01-31T00:00:00.000Z',
): Investment {
  return {
    id,
    trade_deal_id: d.id,
    investor_id: 'trader-x',
    token_amount: amountInvested,
    amount_usd: amountInvested,
    amount_invested: amountInvested,
    token_holdings: amountInvested,
    status: 'confirmed',
    created_at: createdAt,
    expected_return_usd: amountInvested * 1.1,
    actual_return_usd: returnPercentage === null ? null : amountInvested * (1 + returnPercentage / 100),
    return_percentage: returnPercentage,
    deal: d,
  };
}

describe('sample standard deviation and dispersion helpers', () => {
  it('uses the n-1 denominator', () => {
    expect(mean([2, 4, 4, 4, 5, 5, 7, 9])).toBe(5);
    // sum of squared deviations = 32, /7 = 4.571428..., sqrt = 2.13809
    expect(sampleStandardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 5);
    expect(sampleStandardDeviation([0.01])).toBe(0);
    expect(sampleStandardDeviation([])).toBe(0);
  });

  it('computes downside deviation over all periods against a 0% target', () => {
    // negatives are -0.1 and -0.1: (0.01 + 0.01) / 4 = 0.005 -> sqrt = 0.0707107
    expect(downsideDeviation(SWING)).toBeCloseTo(0.07071068, 8);
    expect(downsideDeviation([0.01, 0.02, 0.03])).toBe(0);
  });
});

describe('computeRiskAdjustedMetrics', () => {
  it('returns zeros for an empty series', () => {
    expect(computeRiskAdjustedMetrics([])).toEqual({
      sharpe: 0,
      sortino: 0,
      calmar: 0,
      maxDrawdown: 0,
      volatility: 0,
    });
  });

  it('annualises volatility as stdev * sqrt(12)', () => {
    // sqrt(0.04/3) * sqrt(12) = sqrt(0.16) = 0.4 exactly
    const result = computeRiskAdjustedMetrics(SWING);
    expect(result.volatility).toBe(0.4);
    expect(result.sharpe).toBe(0);
    expect(result.sortino).toBe(0);
    expect(result.maxDrawdown).toBeCloseTo(0.109, 3);
  });

  it('caps Calmar on the 1% drawdown floor', () => {
    const result = computeRiskAdjustedMetrics(SWING);
    // annualised = 0.9801^3 - 1 = -0.058464, over the 0.109 drawdown = -0.5369
    expect(result.calmar).toBeCloseTo(-0.5369, 3);
  });

  it('subtracts the compounded monthly risk-free rate', () => {
    const returns = [0.01, 0.02, 0.03];
    // mean 0.02, rf monthly 1.03^(1/12)-1 = 0.00246627, stdev 0.01
    // sharpe = (0.02 - 0.00246627) / 0.01 * sqrt(12) = 6.0735
    expect(computeRiskAdjustedMetrics(returns, 0.03).sharpe).toBeCloseTo(6.0735, 3);
    expect(computeRiskAdjustedMetrics(returns).sharpe).toBeCloseTo(6.9282, 3);
  });

  it('falls back to Sharpe when a window contains no losing periods', () => {
    const metrics = computeRiskAdjustedMetrics([0.01, 0.02, 0.03]);
    expect(metrics.sortino).toBe(metrics.sharpe);
    expect(metrics.maxDrawdown).toBe(0);
  });

  it('measures max drawdown from the compounded curve', () => {
    expect(computeMaxDrawdown([0.1, -0.1, 0.1, -0.1])).toBeCloseTo(0.109, 3);
    expect(computeMaxDrawdown([0.01, 0.02, 0.03])).toBe(0);
    expect(computeMaxDrawdown([-0.5, 0.1])).toBeCloseTo(0.5, 10);
  });
});

describe('compounding and annualisation', () => {
  it('compounds multiplicatively', () => {
    expect(compoundReturn([0.1, 0.1])).toBeCloseTo(0.21, 10);
    expect(compoundReturn([])).toBe(0);
  });

  it('annualises geometrically by 12/n', () => {
    // (1 + 0.21)^(12/2) - 1 = 1.21^6 - 1 = 2.138428
    expect(annualizeReturn([0.1, 0.1])).toBeCloseTo(2.1384, 3);
    expect(annualizeReturn([])).toBe(0);
  });
});

describe('buildPerformanceHistory', () => {
  it('labels periods and compounds cumulative return', () => {
    expect(buildPerformanceHistory([0.01, 0.02, -0.01], '2025-01')).toEqual([
      { period: '2025-01', returnPct: 1, cumulativePct: 1, equityIndex: 101 },
      { period: '2025-02', returnPct: 2, cumulativePct: 3.02, equityIndex: 103.02 },
      { period: '2025-03', returnPct: -1, cumulativePct: 1.99, equityIndex: 101.99 },
    ]);
  });

  it('rolls the period label across the year boundary', () => {
    const history = buildPerformanceHistory([0, 0, 0], '2025-11');
    expect(history.map((p) => p.period)).toEqual(['2025-11', '2025-12', '2026-01']);
  });
});

describe('windowReturns', () => {
  it('slices the trailing months', () => {
    const twelve = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    expect(windowReturns(twelve, '1m')).toEqual([12]);
    expect(windowReturns(twelve, '3m')).toEqual([10, 11, 12]);
    expect(windowReturns(twelve, '6m')).toEqual([7, 8, 9, 10, 11, 12]);
    expect(windowReturns(twelve, '12m')).toEqual(twelve);
    expect(windowReturns(twelve, 'all')).toEqual(twelve);
    expect(windowReturns([1, 2], '12m')).toEqual([1, 2]);
  });
});

describe('computeConsistencyScore', () => {
  it('weights positive periods, volatility and the worst month', () => {
    // [0.01, 0.02, 0.03]: 3/3 positive, volatility 0.034641/0.3 -> 0.11547,
    // worst +0.01 -> tail leg = 1 - 0.01/0.1 = 0.9
    // 0.55*1 + 0.25*(1-0.11547) + 0.20*0.9 = 0.95113
    expect(computeConsistencyScore([0.01, 0.02, 0.03])).toBeCloseTo(95.11, 1);
    expect(computeConsistencyScore([])).toBe(0);
    // all-losing series: 0 on the positive leg, zero volatility, tail leg saturated
    expect(computeConsistencyScore([-0.2, -0.2])).toBe(25);
  });
});

describe('monthsBetween', () => {
  it('counts whole calendar months', () => {
    expect(monthsBetween('2024-01-15', '2026-10-15')).toBe(33);
    expect(monthsBetween('2024-01-15', '2026-10-14')).toBe(32);
    expect(monthsBetween('2024-01-15', '2024-01-10')).toBe(0);
  });
});

describe('exposure and default helpers', () => {
  it('weights exposure by deployed capital', () => {
    const cocoa = deal({ id: 'd1' });
    const coffee = deal({ id: 'd2', commodity: 'Coffee' });
    const exposures = computeExposures([
      investment('i1', cocoa, 6_000, 10),
      investment('i2', coffee, 4_000, -5),
    ]);
    expect(exposures).toEqual([
      { sector: 'Cocoa', sharePct: 60, deployedUsd: 6000 },
      { sector: 'Coffee', sharePct: 40, deployedUsd: 4000 },
    ]);
  });

  it('counts failed deals as defaults', () => {
    expect(
      dealDefaultRatePct([
        deal({ id: 'a', status: 'completed' }),
        deal({ id: 'b', status: 'failed' }),
        deal({ id: 'c', status: 'failed' }),
        deal({ id: 'd', status: 'open' }),
      ]),
    ).toBe(50);
    expect(dealDefaultRatePct([])).toBe(0);
  });
});

describe('buildTraderProfile', () => {
  const cocoa = deal({ id: 'd1', commodity: 'Cocoa', delivery_date: '2026-04-30' });
  const maize = deal({ id: 'd2', commodity: 'Maize', status: 'failed', delivery_date: '2026-05-31' });
  const investments = [
    investment('i1', cocoa, 10_000, 12, '2026-01-31T00:00:00.000Z'),
    investment('i2', maize, 5_000, -40, '2026-02-28T00:00:00.000Z'),
    investment('i3', cocoa, 5_000, null, '2026-03-31T00:00:00.000Z'),
  ];

  const profile = buildTraderProfile(
    {
      traderId: 'trader-x',
      displayName: 'Trader X',
      bio: 'x',
      strategySummary: 's',
      focusSectors: ['Cocoa'],
      regions: ['West Africa'],
      joinedAt: '2024-01-31T00:00:00.000Z',
      verified: true,
      aumUsd: 100_000,
      followerCount: 5,
      monthlyReturns: [0.01, 0.02, 0.03],
      firstReturnPeriod: '2026-08',
    },
    [cocoa, maize],
    investments,
    { asOf: SAMPLE_AS_OF },
  );

  it('derives cumulative and realised return separately', () => {
    expect(profile.metrics.cumulativeReturnPct).toBe(6.11);
    // cost of settled = 15000, pnl = 10000*0.12 + 5000*-0.40 = 1200 - 2000 = -800
    expect(profile.metrics.realizedRoiPct).toBeCloseTo(-5.33, 2);
    expect(profile.metrics.winRatePct).toBe(50);
  });

  it('computes average holding days from deal delivery dates', () => {
    // 2026-01-31 -> 2026-04-30 = 89 days, 2026-02-28 -> 2026-05-31 = 92 days
    expect(profile.metrics.avgHoldingDays).toBe(90.5);
  });

  it('records exposures, defaults and tenure', () => {
    // exposure weights every investment, settled or not: cocoa 15000 of 20000
    expect(profile.metrics.exposures).toEqual([
      { sector: 'Cocoa', sharePct: 75, deployedUsd: 15000 },
      { sector: 'Maize', sharePct: 25, deployedUsd: 5000 },
    ]);
    expect(profile.metrics.topExposurePct).toBe(75);
    expect(profile.metrics.defaultRatePct).toBe(50);
    expect(profile.metrics.tenureMonths).toBe(32);
  });

  it('exposes the sparkline and raw series used by the boards', () => {
    expect(profile.sparkline).toEqual([1, 3.02, 6.11]);
    expect(profile.monthlyReturns).toEqual([0.01, 0.02, 0.03]);
    expect(profile.firstReturnPeriod).toBe('2026-08');
    expect(profile.performance).toHaveLength(3);
  });
});

describe('sample profiles', () => {
  const profiles = buildSampleProfiles(SAMPLE_AS_OF);

  it('covers every sector, region and risk behaviour the UI renders', () => {
    expect(profiles).toHaveLength(8);
    expect(profiles.map((p) => p.traderId)).toEqual([
      'trader-amina',
      'trader-koji',
      'trader-chidi',
      'trader-tunde',
      'trader-marta',
      'trader-ife',
      'trader-ba',
      'trader-ravi',
    ]);
    expect(profiles.every((p) => p.performance.length === p.monthlyReturns.length)).toBe(true);
    expect(profiles.every((p) => p.metrics.periodCount > 0)).toBe(true);
  });

  it('keeps the highest and lowest risk traders far apart', () => {
    const byDrawdown = [...profiles].sort((a, b) => b.metrics.maxDrawdownPct - a.metrics.maxDrawdownPct);
    expect(byDrawdown[0].traderId).toBe('trader-ravi');
    expect(byDrawdown[0].metrics.maxDrawdownPct).toBeCloseTo(29.15, 2);
    expect(byDrawdown[byDrawdown.length - 1].metrics.maxDrawdownPct).toBe(0);
  });
});
