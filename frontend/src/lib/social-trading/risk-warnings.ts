/**
 * Copy-risk assessment (issue #1212).
 *
 * Produces a 0-100 composite risk score (higher = riskier) from six weighted
 * factors, plus concrete `RiskWarning` items with mitigations. Pure and fully
 * deterministic so the UI copy and the unit tests agree on every number.
 *
 * Factor weights (sum = 1): concentration 0.18, drawdown 0.20, return dispersion
 * & hit rate 0.15, short tenure 0.12, deal default rate 0.18, copy-config
 * aggressiveness 0.17.
 */

import type {
  CopyConfig,
  CopyPerformanceStats,
  RiskAssessment,
  RiskFactor,
  RiskSeverity,
  RiskTier,
  RiskWarning,
  TraderProfile,
} from './types';

export const RISK_WEIGHTS = {
  concentration: 0.18,
  drawdown: 0.2,
  dispersion: 0.15,
  tenure: 0.12,
  defaults: 0.18,
  configAggressiveness: 0.17,
} as const;

/** Observed values at which a factor saturates at 100. */
export const RISK_SATURATION = {
  topExposurePct: 80,
  maxDrawdownPct: 40,
  volatilityPct: 30,
  tenureMonths: 36,
  defaultRatePct: 25,
} as const;

export const RISK_TIER_THRESHOLDS = {
  low: 25,
  moderate: 45,
  elevated: 65,
} as const;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function scaled(value: number, saturation: number): number {
  return Math.round(clamp01(value / saturation) * 10_000) / 100;
}

export function concentrationSubscore(topExposurePct: number): number {
  return scaled(topExposurePct, RISK_SATURATION.topExposurePct);
}

export function drawdownSubscore(maxDrawdownPct: number): number {
  return scaled(maxDrawdownPct, RISK_SATURATION.maxDrawdownPct);
}

/** Half the miss rate, half the annualised volatility. */
export function dispersionSubscore(winRatePct: number, volatilityPct: number): number {
  const miss = 100 - Math.max(0, Math.min(100, winRatePct));
  const vol = scaled(volatilityPct, RISK_SATURATION.volatilityPct);
  return Math.round((0.5 * miss + 0.5 * vol) * 100) / 100;
}

export function tenureSubscore(tenureMonths: number): number {
  const months = Math.max(0, tenureMonths);
  return Math.round(clamp01(1 - months / RISK_SATURATION.tenureMonths) * 10_000) / 100;
}

export function defaultRateSubscore(defaultRatePct: number): number {
  return scaled(defaultRatePct, RISK_SATURATION.defaultRatePct);
}

export interface AggressivenessBreakdown {
  sizeConcentration: number;
  budgetAggression: number;
  weakControls: number;
  noBlacklist: number;
}

export const AGGRESSIVENESS_WEIGHTS = {
  sizeConcentration: 0.35,
  budgetAggression: 0.25,
  weakControls: 0.25,
  noBlacklist: 0.15,
} as const;

export function aggressivenessBreakdown(config: CopyConfig): AggressivenessBreakdown {
  const monthly = config.monthlyLimit > 0 ? config.monthlyLimit : 1;
  const sizeConcentration = Math.round(clamp01(config.maxPerTrade / monthly) * 10_000) / 100;

  let budgetRaw = 0;
  if (config.mode === 'proportional') budgetRaw = config.allocationPct / 100;
  else if (config.mode === 'fixed') budgetRaw = config.fixedAmountUsd / monthly;
  else budgetRaw = config.riskBudgetPct / 20;
  const budgetAggression = Math.round(clamp01(budgetRaw) * 10_000) / 100;

  const stopLeg =
    config.autoStopLossPct <= 0
      ? 100
      : Math.round(clamp01((25 - config.autoStopLossPct) / 25) * 10_000) / 100;
  const drawdownLeg =
    config.maxDrawdownPct <= 0
      ? 100
      : Math.round(clamp01((30 - config.maxDrawdownPct) / 30) * 10_000) / 100;
  const weakControls = Math.round(((stopLeg + drawdownLeg) / 2) * 100) / 100;

  return {
    sizeConcentration,
    budgetAggression,
    weakControls,
    noBlacklist: config.blacklist.length === 0 ? 100 : 0,
  };
}

export function configAggressivenessSubscore(config: CopyConfig): number {
  const parts = aggressivenessBreakdown(config);
  const score =
    AGGRESSIVENESS_WEIGHTS.sizeConcentration * parts.sizeConcentration +
    AGGRESSIVENESS_WEIGHTS.budgetAggression * parts.budgetAggression +
    AGGRESSIVENESS_WEIGHTS.weakControls * parts.weakControls +
    AGGRESSIVENESS_WEIGHTS.noBlacklist * parts.noBlacklist;
  return Math.round(score * 100) / 100;
}

export function riskTierForScore(score: number): RiskTier {
  if (score < RISK_TIER_THRESHOLDS.low) return 'low';
  if (score < RISK_TIER_THRESHOLDS.moderate) return 'moderate';
  if (score < RISK_TIER_THRESHOLDS.elevated) return 'elevated';
  return 'high';
}

function warning(
  severity: RiskSeverity,
  code: string,
  message: string,
  mitigation: string,
): RiskWarning {
  return { severity, code, message, mitigation };
}

export function buildRiskFactors(
  profile: TraderProfile,
  config: CopyConfig,
): RiskFactor[] {
  const metrics = profile.metrics;
  const inputs: Array<{
    key: string;
    label: string;
    weight: number;
    observed: number;
    subscore: number;
  }> = [
    {
      key: 'concentration',
      label: 'Sector concentration',
      weight: RISK_WEIGHTS.concentration,
      observed: metrics.topExposurePct,
      subscore: concentrationSubscore(metrics.topExposurePct),
    },
    {
      key: 'drawdown',
      label: 'Historical max drawdown',
      weight: RISK_WEIGHTS.drawdown,
      observed: metrics.maxDrawdownPct,
      subscore: drawdownSubscore(metrics.maxDrawdownPct),
    },
    {
      key: 'dispersion',
      label: 'Return dispersion and hit rate',
      weight: RISK_WEIGHTS.dispersion,
      observed: metrics.volatilityPct,
      subscore: dispersionSubscore(metrics.winRatePct, metrics.volatilityPct),
    },
    {
      key: 'tenure',
      label: 'Trading tenure',
      weight: RISK_WEIGHTS.tenure,
      observed: metrics.tenureMonths,
      subscore: tenureSubscore(metrics.tenureMonths),
    },
    {
      key: 'defaults',
      label: 'Deal default rate',
      weight: RISK_WEIGHTS.defaults,
      observed: metrics.defaultRatePct,
      subscore: defaultRateSubscore(metrics.defaultRatePct),
    },
    {
      key: 'configAggressiveness',
      label: 'Copy configuration aggressiveness',
      weight: RISK_WEIGHTS.configAggressiveness,
      observed: config.maxPerTrade,
      subscore: configAggressivenessSubscore(config),
    },
  ];

  return inputs.map((input) => ({
    ...input,
    points: Math.round(input.weight * input.subscore * 100) / 100,
  }));
}

export function collectRiskWarnings(
  profile: TraderProfile,
  stats: CopyPerformanceStats | null,
  config: CopyConfig,
): RiskWarning[] {
  const warnings: RiskWarning[] = [];
  const metrics = profile.metrics;

  if (metrics.topExposurePct >= 55) {
    warnings.push(
      warning(
        'critical',
        'HIGH_CONCENTRATION',
        `${metrics.topExposurePct}% of this trader's capital sits in a single commodity.`,
        'Diversify across at least three sectors or lower the per-trade cap.',
      ),
    );
  } else if (metrics.topExposurePct >= 35) {
    warnings.push(
      warning(
        'warning',
        'CONCENTRATION_WATCH',
        `Largest sector exposure is ${metrics.topExposurePct}%.`,
        'Pair this copy with uncorrelated traders or sectors.',
      ),
    );
  }

  if (metrics.maxDrawdownPct >= 25) {
    warnings.push(
      warning(
        'critical',
        'DEEP_DRAWDOWN',
        `History shows a ${metrics.maxDrawdownPct}% peak-to-trough drawdown.`,
        'Set max drawdown auto-stop at or below half of that figure.',
      ),
    );
  } else if (metrics.maxDrawdownPct >= 15) {
    warnings.push(
      warning(
        'warning',
        'DRAWDOWN_RISK',
        `Max drawdown of ${metrics.maxDrawdownPct}% is material for trade finance.`,
        'Reduce the monthly limit so a drawdown stays affordable.',
      ),
    );
  }

  if (metrics.volatilityPct >= 20) {
    warnings.push(
      warning(
        'warning',
        'VOLATILE_TRACK_RECORD',
        `Annualised volatility is ${metrics.volatilityPct}% with a ${metrics.winRatePct}% win rate.`,
        'Expect long flat stretches; only copy with surplus capital.',
      ),
    );
  }

  if (metrics.winRatePct > 0 && metrics.winRatePct < 45) {
    warnings.push(
      warning(
        'critical',
        'LOW_WIN_RATE',
        `Only ${metrics.winRatePct}% of settled positions were profitable.`,
        'Prefer traders above a 55% hit rate, or copy the strategy not the trader.',
      ),
    );
  } else if (metrics.winRatePct > 0 && metrics.winRatePct < 55) {
    warnings.push(
      warning(
        'warning',
        'MODEST_WIN_RATE',
        `Hit rate of ${metrics.winRatePct}% depends on a few large winners.`,
        'Cap the per-trade size so single losses stay small.',
      ),
    );
  }

  if (metrics.tenureMonths < 6) {
    warnings.push(
      warning(
        'critical',
        'COLD_TRACK_RECORD',
        `This trader has only ${metrics.tenureMonths} months of verifiable history.`,
        'Wait for 12 months of records or copy with a token amount.',
      ),
    );
  } else if (metrics.tenureMonths < 12) {
    warnings.push(
      warning(
        'warning',
        'SHORT_TENURE',
        `${metrics.tenureMonths} months of history has not survived a full harvest cycle.`,
        'Review the copy monthly and keep the auto-stop tight.',
      ),
    );
  }

  if (metrics.defaultRatePct >= 10) {
    warnings.push(
      warning(
        'critical',
        'HIGH_DEFAULT_RATE',
        `${metrics.defaultRatePct}% of this trader's deals defaulted.`,
        'Copy only deals with an ESG score above 60 and a low risk rating.',
      ),
    );
  } else if (metrics.defaultRatePct >= 5) {
    warnings.push(
      warning(
        'warning',
        'DEFAULT_RATE_ELEVATED',
        `Deal default rate is ${metrics.defaultRatePct}%.`,
        'Blacklist the sectors driving those defaults.',
      ),
    );
  }

  if (!profile.verified) {
    warnings.push(
      warning(
        'info',
        'UNVERIFIED_TRADER',
        'This trader profile is not KYC-verified.',
        'Verify the counterparty before increasing copy limits.',
      ),
    );
  }

  if (config.mode === 'proportional' && config.allocationPct > 100) {
    warnings.push(
      warning(
        'critical',
        'LEVERAGED_COPYING',
        `Allocation of ${config.allocationPct}% copies larger than the leader's weight.`,
        'Keep allocation at 100% or below unless you intend to gear the copy.',
      ),
    );
  }

  if (config.monthlyLimit > 0 && config.maxPerTrade / config.monthlyLimit >= 0.5) {
    warnings.push(
      warning(
        'warning',
        'CONCENTRATED_ALLOWANCE',
        'A single copied trade can consume half of the monthly allowance.',
        'Lower the per-trade cap so the month is spread over several deals.',
      ),
    );
  }

  if (config.autoStopLossPct <= 0) {
    warnings.push(
      warning(
        'warning',
        'NO_STOP_LOSS',
        'Portfolio stop-loss is disabled for this copy.',
        'Enable a stop-loss at or below 10% to bound the downside.',
      ),
    );
  }

  if (config.maxDrawdownPct <= 0) {
    warnings.push(
      warning(
        'warning',
        'NO_DRAWDOWN_STOP',
        'Drawdown auto-stop is disabled, so copying never halts on losses.',
        'Set a max drawdown stop before deploying more capital.',
      ),
    );
  }

  if (config.blacklist.length === 0) {
    warnings.push(
      warning(
        'info',
        'EMPTY_BLACKLIST',
        'No commodities, regions or deals are blacklisted.',
        'Exclude sectors you do not want to fund.',
      ),
    );
  }

  if (!config.enabled) {
    warnings.push(
      warning(
        'info',
        'COPY_DISABLED',
        'Copy trading for this trader is currently switched off.',
        'Re-enable it once you accept the risks above.',
      ),
    );
  }

  if (stats && stats.totalCopies > 0) {
    if (stats.totalCopies < 5) {
      warnings.push(
        warning(
          'info',
          'INSUFFICIENT_COPY_HISTORY',
          `Only ${stats.totalCopies} copied trades have settled so far.`,
          'Keep limits small until at least ten copies are recorded.',
        ),
      );
    }
    if (stats.fidelity < 0.6) {
      warnings.push(
        warning(
          'warning',
          'LOW_COPY_FIDELITY',
          `Follower returns track the leader at r=${stats.fidelity}.`,
          'Check slippage and ticket-size mismatch, or copy fewer traders.',
        ),
      );
    }
    if (stats.avgSlippagePct > 0.5) {
      warnings.push(
        warning(
          'warning',
          'ENTRY_SLIPPAGE',
          `Copies enter ${stats.avgSlippagePct}% worse than the leader on average.`,
          'Enable notifications so copies fire earlier in the round.',
        ),
      );
    }
    if (stats.profitFactor !== null && stats.profitFactor < 1) {
      warnings.push(
        warning(
          'critical',
          'NEGATIVE_EDGE',
          `Realised copies returned a profit factor of ${stats.profitFactor}.`,
          'Stop copying this trader and review the risk warnings.',
        ),
      );
    } else if (stats.totalCopies >= 5 && stats.successRatePct < 45) {
      warnings.push(
        warning(
          'warning',
          'LOW_COPY_SUCCESS_RATE',
          `Only ${stats.successRatePct}% of your copies on this trader were profitable.`,
          'Raise the minimum trade size and blacklist low-rated deals.',
        ),
      );
    }
  }

  return warnings;
}

export function assessCopyRisk(
  profile: TraderProfile,
  stats: CopyPerformanceStats | null,
  config: CopyConfig,
  options: { assessedAt?: string } = {},
): RiskAssessment {
  const factors = buildRiskFactors(profile, config);
  const raw = factors.reduce((sum, f) => sum + f.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw * 100) / 100));

  return {
    traderId: profile.traderId,
    score,
    tier: riskTierForScore(score),
    warnings: collectRiskWarnings(profile, stats, config),
    factors,
    assessedAt: options.assessedAt ?? new Date().toISOString(),
  };
}

export function highestSeverity(warnings: RiskWarning[]): RiskSeverity | null {
  if (warnings.some((w) => w.severity === 'critical')) return 'critical';
  if (warnings.some((w) => w.severity === 'warning')) return 'warning';
  if (warnings.some((w) => w.severity === 'info')) return 'info';
  return null;
}
