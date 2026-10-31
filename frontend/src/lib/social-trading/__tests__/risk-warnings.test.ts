import { describe, expect, it } from 'vitest';

import {
  AGGRESSIVENESS_WEIGHTS,
  RISK_SATURATION,
  RISK_TIER_THRESHOLDS,
  RISK_WEIGHTS,
  aggressivenessBreakdown,
  assessCopyRisk,
  buildRiskFactors,
  collectRiskWarnings,
  configAggressivenessSubscore,
  concentrationSubscore,
  defaultRateSubscore,
  dispersionSubscore,
  drawdownSubscore,
  highestSeverity,
  riskTierForScore,
  tenureSubscore,
} from '../risk-warnings';
import { makeCopyConfig } from '../copy-trading';
import type { CopyConfig, CopyPerformanceStats, RiskTier, TraderProfile } from '../types';

function riskProfile(overrides: Partial<TraderProfile['metrics']> & { verified?: boolean } = {}): TraderProfile {
  const { verified, ...metricsOverrides } = overrides;
  return {
    traderId: 't-risk',
    displayName: 'Risk Fixture',
    verified: verified ?? true,
    focusSectors: ['Coffee'],
    regions: ['Kenya'],
    metrics: {
      topExposurePct: 20,
      maxDrawdownPct: 5,
      volatilityPct: 6,
      winRatePct: 80,
      tenureMonths: 40,
      defaultRatePct: 0,
      ...metricsOverrides,
    },
  } as unknown as TraderProfile;
}

const SAFE_CONFIG: CopyConfig = makeCopyConfig('f1', 't-risk', {
  id: 'safe',
  mode: 'proportional',
  allocationPct: 50,
  maxPerTrade: 500,
  monthlyLimit: 5000,
  autoStopLossPct: 10,
  autoTakeProfitPct: 25,
  maxDrawdownPct: 15,
  blacklist: ['Cocoa'],
  enabled: true,
});

const RECKLESS_CONFIG: CopyConfig = makeCopyConfig('f1', 't-risk', {
  id: 'reckless',
  mode: 'proportional',
  allocationPct: 150,
  maxPerTrade: 10_000,
  monthlyLimit: 10_000,
  autoStopLossPct: 0,
  maxDrawdownPct: 0,
  blacklist: [],
  enabled: false,
});

function stats(overrides: Partial<CopyPerformanceStats> = {}): CopyPerformanceStats {
  return {
    totalCopies: 10,
    successRatePct: 60,
    fidelity: 0.9,
    avgSlippagePct: 0.1,
    profitFactor: 2,
    ...overrides,
  } as unknown as CopyPerformanceStats;
}

describe('factor subscores', () => {
  it('saturates concentration and drawdown at their documented ceilings', () => {
    expect(RISK_SATURATION).toEqual({
      topExposurePct: 80,
      maxDrawdownPct: 40,
      volatilityPct: 30,
      tenureMonths: 36,
      defaultRatePct: 25,
    });
    expect(concentrationSubscore(0)).toBe(0);
    expect(concentrationSubscore(20)).toBe(25);
    expect(concentrationSubscore(80)).toBe(100);
    expect(concentrationSubscore(160)).toBe(100);
    expect(concentrationSubscore(Number.NaN)).toBe(0);
    expect(drawdownSubscore(20)).toBe(50);
    expect(drawdownSubscore(40)).toBe(100);
    expect(drawdownSubscore(-5)).toBe(0);
  });

  it('blends the miss rate and volatility equally in the dispersion factor', () => {
    expect(dispersionSubscore(100, 0)).toBe(0);
    expect(dispersionSubscore(50, 15)).toBe(50);
    expect(dispersionSubscore(0, 30)).toBe(100);
    expect(dispersionSubscore(80, 30)).toBe(60);
    expect(dispersionSubscore(140, 0)).toBe(0);
  });

  it('treats a short record as risky and a mature one as neutral', () => {
    expect(tenureSubscore(0)).toBe(100);
    expect(tenureSubscore(18)).toBe(50);
    expect(tenureSubscore(36)).toBe(0);
    expect(tenureSubscore(120)).toBe(0);
    expect(tenureSubscore(-4)).toBe(100);
  });

  it('scales the default rate against a 25% book', () => {
    expect(defaultRateSubscore(0)).toBe(0);
    expect(defaultRateSubscore(12.5)).toBe(50);
    expect(defaultRateSubscore(25)).toBe(100);
    expect(defaultRateSubscore(80)).toBe(100);
  });
});

describe('config aggressiveness', () => {
  it('weights size concentration, budget, controls and the missing blacklist', () => {
    expect(AGGRESSIVENESS_WEIGHTS).toEqual({
      sizeConcentration: 0.35,
      budgetAggression: 0.25,
      weakControls: 0.25,
      noBlacklist: 0.15,
    });
    // 500 of a 5000 monthly limit, half-weight allocation, 10% stop, 15% drawdown stop.
    expect(aggressivenessBreakdown(SAFE_CONFIG)).toEqual({
      sizeConcentration: 10,
      budgetAggression: 50,
      weakControls: 55,
      noBlacklist: 0,
    });
    expect(configAggressivenessSubscore(SAFE_CONFIG)).toBe(29.75);
  });

  it('maxes out when every control is off', () => {
    expect(aggressivenessBreakdown(RECKLESS_CONFIG)).toEqual({
      sizeConcentration: 100,
      budgetAggression: 100,
      weakControls: 100,
      noBlacklist: 100,
    });
    expect(configAggressivenessSubscore(RECKLESS_CONFIG)).toBe(100);
  });

  it('sizes the budget leg differently per copy mode', () => {
    const base = makeCopyConfig('f1', 't', { monthlyLimit: 2000, maxPerTrade: 200 });
    expect(
      aggressivenessBreakdown({ ...base, mode: 'fixed', fixedAmountUsd: 500 }).budgetAggression,
    ).toBe(25);
    expect(
      aggressivenessBreakdown({ ...base, mode: 'inverse_risk', riskBudgetPct: 10 }).budgetAggression,
    ).toBe(50);
    expect(
      aggressivenessBreakdown({ ...base, mode: 'inverse_risk', riskBudgetPct: 40 }).budgetAggression,
    ).toBe(100);
    expect(
      aggressivenessBreakdown({ ...base, mode: 'proportional', allocationPct: 25 }).budgetAggression,
    ).toBe(25);
  });

  it('falls back to a unit denominator when the monthly limit is not set', () => {
    const broken = makeCopyConfig('f1', 't', { monthlyLimit: 0, maxPerTrade: 250 });
    expect(aggressivenessBreakdown(broken).sizeConcentration).toBe(100);
    expect(aggressivenessBreakdown(broken).budgetAggression).toBe(100);
  });

  it('penalises a wide stop-loss only partially', () => {
    const loose = makeCopyConfig('f1', 't', { autoStopLossPct: 25, maxDrawdownPct: 30 });
    expect(aggressivenessBreakdown(loose).weakControls).toBe(0);
    const off = makeCopyConfig('f1', 't', { autoStopLossPct: 0, maxDrawdownPct: 0 });
    expect(aggressivenessBreakdown(off).weakControls).toBe(100);
  });
});

describe('risk tiers', () => {
  it('maps score bands to tiers at the documented cut-offs', () => {
    expect(RISK_TIER_THRESHOLDS).toEqual({ low: 25, moderate: 45, elevated: 65 });
    const cases: [number, RiskTier][] = [
      [0, 'low'],
      [24.99, 'low'],
      [25, 'moderate'],
      [44.99, 'moderate'],
      [45, 'elevated'],
      [64.99, 'elevated'],
      [65, 'high'],
      [100, 'high'],
    ];
    for (const [score, tier] of cases) expect(riskTierForScore(score)).toBe(tier);
  });
});

describe('buildRiskFactors', () => {
  it('emits all six factors with weights that sum to one', () => {
    const factors = buildRiskFactors(riskProfile(), SAFE_CONFIG);
    expect(RISK_WEIGHTS).toEqual({
      concentration: 0.18,
      drawdown: 0.2,
      dispersion: 0.15,
      tenure: 0.12,
      defaults: 0.18,
      configAggressiveness: 0.17,
    });
    expect(factors.map((f) => f.key)).toEqual([
      'concentration',
      'drawdown',
      'dispersion',
      'tenure',
      'defaults',
      'configAggressiveness',
    ]);
    expect(factors.reduce((sum, f) => sum + f.weight, 0)).toBeCloseTo(1, 10);
    expect(factors.map((f) => f.weight)).toEqual([0.18, 0.2, 0.15, 0.12, 0.18, 0.17]);
  });

  it('pairs each observed input with its subscore and weighted points', () => {
    expect(buildRiskFactors(riskProfile(), SAFE_CONFIG)).toEqual([
      { key: 'concentration', label: 'Sector concentration', weight: 0.18, observed: 20, subscore: 25, points: 4.5 },
      { key: 'drawdown', label: 'Historical max drawdown', weight: 0.2, observed: 5, subscore: 12.5, points: 2.5 },
      { key: 'dispersion', label: 'Return dispersion and hit rate', weight: 0.15, observed: 6, subscore: 20, points: 3 },
      { key: 'tenure', label: 'Trading tenure', weight: 0.12, observed: 40, subscore: 0, points: 0 },
      { key: 'defaults', label: 'Deal default rate', weight: 0.18, observed: 0, subscore: 0, points: 0 },
      {
        key: 'configAggressiveness',
        label: 'Copy configuration aggressiveness',
        weight: 0.17,
        observed: 500,
        subscore: 29.75,
        points: 5.06,
      },
    ]);
  });
});

describe('assessCopyRisk', () => {
  it('sums the weighted factor points and lands in the low tier', () => {
    const assessment = assessCopyRisk(riskProfile(), null, SAFE_CONFIG, {
      assessedAt: '2026-10-01T00:00:00.000Z',
    });
    expect(assessment.assessedAt).toBe('2026-10-01T00:00:00.000Z');
    expect(assessment.traderId).toBe('t-risk');
    expect(assessment.score).toBe(15.06);
    expect(assessment.tier).toBe('low');
    expect(assessment.warnings).toEqual([]);
  });

  it('reaches the high tier for an immature concentrated trader on a reckless config', () => {
    const assessment = assessCopyRisk(
      riskProfile({
        topExposurePct: 80,
        maxDrawdownPct: 40,
        volatilityPct: 30,
        winRatePct: 30,
        tenureMonths: 4,
        defaultRatePct: 25,
        verified: false,
      }),
      null,
      RECKLESS_CONFIG,
      { assessedAt: '2026-10-01T00:00:00.000Z' },
    );
    expect(assessment.factors.map((f) => f.subscore)).toEqual([100, 100, 85, 88.89, 100, 100]);
    expect(assessment.factors.map((f) => f.points)).toEqual([18, 20, 12.75, 10.67, 18, 17]);
    expect(assessment.score).toBe(96.42);
    expect(assessment.tier).toBe('high');
  });

  it('tops out at exactly 100 when every factor saturates', () => {
    const profile = riskProfile({
      topExposurePct: 1_000_000,
      maxDrawdownPct: 1_000_000,
      volatilityPct: 1_000_000,
      winRatePct: 0,
      tenureMonths: 0,
      defaultRatePct: 1_000_000,
      verified: false,
    });
    const assessment = assessCopyRisk(profile, null, RECKLESS_CONFIG);
    expect(assessment.factors.map((f) => f.subscore)).toEqual([100, 100, 100, 100, 100, 100]);
    expect(assessment.score).toBe(100);
    expect(assessment.tier).toBe('high');
  });

  it('absorbs an extra volatility leg without leaving the band', () => {
    const assessment = assessCopyRisk(
      riskProfile({ tenureMonths: Number.NaN }),
      null,
      SAFE_CONFIG,
    );
    expect(Number.isFinite(assessment.score)).toBe(true);
    expect(assessment.score).toBe(15.06);
  });

  it('adds the dispersion leg when volatility and hit rate worsen', () => {
    const assessment = assessCopyRisk(riskProfile({ volatilityPct: 24, winRatePct: 40 }), null, SAFE_CONFIG);
    // dispersion = 0.5 * (100 - 40) + 0.5 * (24 / 30 * 100) = 70 -> 0.15 * 70 = 10.5.
    expect(assessment.factors[2]).toMatchObject({ subscore: 70, points: 10.5 });
    expect(assessment.score).toBe(22.56);
    expect(assessment.tier).toBe('low');
  });
});

describe('collectRiskWarnings', () => {
  it('fires every trader-side warning in severity order of the checks', () => {
    const profile = riskProfile({
      topExposurePct: 80,
      maxDrawdownPct: 40,
      volatilityPct: 30,
      winRatePct: 30,
      tenureMonths: 4,
      defaultRatePct: 25,
      verified: false,
    });
    const warnings = collectRiskWarnings(profile, null, RECKLESS_CONFIG);
    expect(warnings.map((w) => w.code)).toEqual([
      'HIGH_CONCENTRATION',
      'DEEP_DRAWDOWN',
      'VOLATILE_TRACK_RECORD',
      'LOW_WIN_RATE',
      'COLD_TRACK_RECORD',
      'HIGH_DEFAULT_RATE',
      'UNVERIFIED_TRADER',
      'LEVERAGED_COPYING',
      'CONCENTRATED_ALLOWANCE',
      'NO_STOP_LOSS',
      'NO_DRAWDOWN_STOP',
      'EMPTY_BLACKLIST',
      'COPY_DISABLED',
    ]);
    expect(warnings[0]).toEqual({
      severity: 'critical',
      code: 'HIGH_CONCENTRATION',
      message: "80% of this trader's capital sits in a single commodity.",
      mitigation: 'Diversify across at least three sectors or lower the per-trade cap.',
    });
    expect(highestSeverity(warnings)).toBe('critical');
  });

  it('uses the watch bands before the critical bands', () => {
    const profile = riskProfile({
      topExposurePct: 40,
      maxDrawdownPct: 18,
      winRatePct: 50,
      tenureMonths: 9,
      defaultRatePct: 7,
    });
    expect(collectRiskWarnings(profile, null, SAFE_CONFIG).map((w) => w.code)).toEqual([
      'CONCENTRATION_WATCH',
      'DRAWDOWN_RISK',
      'MODEST_WIN_RATE',
      'SHORT_TENURE',
      'DEFAULT_RATE_ELEVATED',
    ]);
  });

  it('stays silent at the exact band boundaries', () => {
    const profile = riskProfile({
      topExposurePct: 34.9,
      maxDrawdownPct: 14.9,
      volatilityPct: 19.9,
      winRatePct: 55,
      tenureMonths: 12,
      defaultRatePct: 4.9,
    });
    expect(collectRiskWarnings(profile, null, SAFE_CONFIG)).toEqual([]);
    // The same profile one tenth higher trips every watch band again.
    const tripped = riskProfile({
      topExposurePct: 55,
      maxDrawdownPct: 25,
      volatilityPct: 20,
      winRatePct: 44.9,
      tenureMonths: 12,
      defaultRatePct: 10,
    });
    expect(collectRiskWarnings(tripped, null, SAFE_CONFIG).map((w) => w.code)).toEqual([
      'HIGH_CONCENTRATION',
      'DEEP_DRAWDOWN',
      'VOLATILE_TRACK_RECORD',
      'LOW_WIN_RATE',
      'HIGH_DEFAULT_RATE',
    ]);
  });

  it('ignores a zero win rate rather than calling it low', () => {
    const profile = riskProfile({ winRatePct: 0 });
    expect(collectRiskWarnings(profile, null, SAFE_CONFIG)).toEqual([]);
  });

  it('reports thin copy history, poor fidelity and slippage', () => {
    const warnings = collectRiskWarnings(
      riskProfile(),
      stats({ totalCopies: 3, fidelity: 0.4, avgSlippagePct: 1.2, profitFactor: 0.8 }),
      SAFE_CONFIG,
    );
    expect(warnings.map((w) => w.code)).toEqual([
      'INSUFFICIENT_COPY_HISTORY',
      'LOW_COPY_FIDELITY',
      'ENTRY_SLIPPAGE',
      'NEGATIVE_EDGE',
    ]);
    expect(warnings[1].message).toBe('Follower returns track the leader at r=0.4.');
  });

  it('prefers the profit-factor verdict over the success-rate one', () => {
    const losing = collectRiskWarnings(riskProfile(), stats({ totalCopies: 6, successRatePct: 30, profitFactor: 0.5 }), SAFE_CONFIG);
    expect(losing.map((w) => w.code)).toEqual(['NEGATIVE_EDGE']);
    const breakEven = collectRiskWarnings(riskProfile(), stats({ totalCopies: 6, successRatePct: 40, profitFactor: null }), SAFE_CONFIG);
    expect(breakEven.map((w) => w.code)).toEqual(['LOW_COPY_SUCCESS_RATE']);
    const healthy = collectRiskWarnings(riskProfile(), stats(), SAFE_CONFIG);
    expect(healthy).toEqual([]);
  });

  it('ranks the highest severity present', () => {
    expect(highestSeverity([])).toBeNull();
    expect(highestSeverity([{ severity: 'info', code: 'X', message: '', mitigation: '' }])).toBe('info');
    expect(
      highestSeverity([
        { severity: 'info', code: 'X', message: '', mitigation: '' },
        { severity: 'warning', code: 'Y', message: '', mitigation: '' },
      ]),
    ).toBe('warning');
    expect(
      highestSeverity([
        { severity: 'warning', code: 'Y', message: '', mitigation: '' },
        { severity: 'critical', code: 'Z', message: '', mitigation: '' },
      ]),
    ).toBe('critical');
  });
});
