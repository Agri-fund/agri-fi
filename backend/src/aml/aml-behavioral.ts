import { AmlPatternType, CashFlow, PatternMatch } from './aml.constants';
import { AmlMonitoringRule } from './entities/aml-monitoring-rule.entity';

/**
 * Behavioural analysis for AML monitoring (#1217).
 *
 * A fixed threshold catches the obvious cases but not "this account normally
 * moves $400 a month and today moved $18,000 to a country it has never
 * transacted with". These functions build each account's own baseline from its
 * history and score recent movements against it, which is also what lets the
 * detector stay quiet for a large institutional investor.
 */

export interface BehaviouralBaseline {
  sampleCount: number;
  meanAmountUsd: number;
  stddevAmountUsd: number;
  meanIntervalHours: number;
  stddevIntervalHours: number;
  knownCountries: string[];
  firstFlowAt: string | null;
  lastFlowAt: string | null;
}

export interface BehaviouralAnomaly {
  flow: CashFlow;
  amountZScore: number;
  cadenceZScore: number | null;
  newCountry: string | null;
  reasons: string[];
}

const HOUR_MS = 3_600_000;

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Sample standard deviation (n-1), 0 when fewer than two samples. */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

export function zScore(
  value: number,
  average: number,
  deviation: number,
): number {
  if (deviation <= 0) return 0;
  return (value - average) / deviation;
}

function intervalsHours(flows: CashFlow[]): number[] {
  const ordered = [...flows].sort((a, b) => a.at.getTime() - b.at.getTime());
  const gaps: number[] = [];
  for (let i = 1; i < ordered.length; i += 1) {
    gaps.push(
      (ordered[i].at.getTime() - ordered[i - 1].at.getTime()) / HOUR_MS,
    );
  }
  return gaps;
}

/**
 * Baseline from the older part of the series (everything before the most recent
 * `recentCount` movements), so a burst of activity is compared against the
 * account's normal behaviour rather than against itself.
 */
export function buildBaseline(
  flows: CashFlow[],
  recentCount = 5,
): BehaviouralBaseline {
  const ordered = [...flows].sort((a, b) => a.at.getTime() - b.at.getTime());
  const splitAt = Math.max(0, ordered.length - Math.max(1, recentCount));
  const history = ordered.slice(0, splitAt);
  const amounts = history
    .map((flow) => flow.amountUsd)
    .filter((amount) => amount > 0);
  const gaps = intervalsHours(history);
  return {
    sampleCount: history.length,
    meanAmountUsd: Math.round(mean(amounts) * 100) / 100,
    stddevAmountUsd: Math.round(stddev(amounts) * 100) / 100,
    meanIntervalHours: Math.round(mean(gaps) * 100) / 100,
    stddevIntervalHours: Math.round(stddev(gaps) * 100) / 100,
    knownCountries: [
      ...new Set(
        history
          .map((flow) => flow.counterpartyCountry)
          .filter((country): country is string => Boolean(country)),
      ),
    ],
    firstFlowAt: ordered[0]?.at.toISOString() ?? null,
    lastFlowAt: ordered[ordered.length - 1]?.at.toISOString() ?? null,
  };
}

/** Recent movements that deviate from the account's own baseline. */
export function findBehaviouralAnomalies(
  flows: CashFlow[],
  options: {
    zScoreThreshold?: number;
    minHistorySamples?: number;
    recentCount?: number;
  } = {},
): { baseline: BehaviouralBaseline; anomalies: BehaviouralAnomaly[] } {
  const zThreshold = options.zScoreThreshold ?? 3;
  const minSamples = options.minHistorySamples ?? 5;
  const recentCount = options.recentCount ?? 5;
  const baseline = buildBaseline(flows, recentCount);
  const ordered = [...flows].sort((a, b) => a.at.getTime() - b.at.getTime());
  const recent = ordered.slice(
    Math.max(0, ordered.length - Math.max(1, recentCount)),
  );

  if (baseline.sampleCount < minSamples) {
    return { baseline, anomalies: [] };
  }

  const anomalies: BehaviouralAnomaly[] = [];
  for (const flow of recent) {
    const amountZ = zScore(
      flow.amountUsd,
      baseline.meanAmountUsd,
      baseline.stddevAmountUsd,
    );
    const previous = ordered[ordered.indexOf(flow) - 1];
    const interval = previous
      ? (flow.at.getTime() - previous.at.getTime()) / HOUR_MS
      : null;
    const cadenceZ =
      interval !== null && baseline.meanIntervalHours > 0
        ? zScore(
            interval,
            baseline.meanIntervalHours,
            baseline.stddevIntervalHours,
          )
        : null;
    const country = flow.counterpartyCountry ?? null;
    const newCountry =
      country && !baseline.knownCountries.includes(country) ? country : null;

    const reasons: string[] = [];
    if (amountZ >= zThreshold) {
      reasons.push(
        `amount $${flow.amountUsd.toFixed(2)} is ${amountZ.toFixed(1)} standard deviations above this account's mean of $${baseline.meanAmountUsd.toFixed(2)}`,
      );
    }
    if (cadenceZ !== null && Math.abs(cadenceZ) >= zThreshold) {
      reasons.push(
        `gap of ${interval?.toFixed(1)}h since the previous movement is ${Math.abs(cadenceZ).toFixed(1)} standard deviations from the usual ${baseline.meanIntervalHours}h cadence`,
      );
    }
    if (newCountry) {
      reasons.push(`first movement involving ${newCountry}`);
    }
    if (reasons.length > 0) {
      anomalies.push({
        flow,
        amountZScore: amountZ,
        cadenceZScore: cadenceZ,
        newCountry,
        reasons,
      });
    }
  }
  return { baseline, anomalies };
}

/** Detector entry point used by the monitoring sweep. */
export function detectBehaviouralAnomalies(
  rule: AmlMonitoringRule,
  flows: CashFlow[],
): PatternMatch[] {
  const { baseline, anomalies } = findBehaviouralAnomalies(flows, {
    zScoreThreshold: Number(rule.parameters?.zScoreThreshold ?? 3),
    minHistorySamples: Number(rule.parameters?.minHistorySamples ?? 5),
    recentCount: Number(rule.parameters?.recentCount ?? 5),
  });

  return anomalies.map((anomaly) => {
    // A new jurisdiction is evidence on its own; a pure amount spike needs the
    // statistical distance to move the score.
    const deviation = Math.max(
      0,
      anomaly.amountZScore,
      Math.abs(anomaly.cadenceZScore ?? 0),
    );
    const magnitudeBoost = anomaly.newCountry
      ? 0.2
      : Math.min(0.75, deviation / 20);
    const base = Number(rule.baseRiskScore ?? 50);
    const sensitivity = Number(rule.sensitivityMultiplier ?? 1);
    const riskScore =
      Math.round(
        Math.min(100, Math.max(0, base * sensitivity * (1 + magnitudeBoost))) *
          100,
      ) / 100;

    return {
      patternType: 'BEHAVIORAL_ANOMALY' as AmlPatternType,
      ruleId: rule.id,
      ruleCode: rule.ruleCode,
      severity: rule.riskLevel,
      action: rule.action,
      baseRiskScore: base,
      riskScore,
      title: `Unusual ${anomaly.flow.direction}flow of $${anomaly.flow.amountUsd.toFixed(2)}`,
      reason: `Account behaviour baseline (${baseline.sampleCount} historical movements, mean $${baseline.meanAmountUsd}): ${anomaly.reasons.join('; ')}.`,
      dedupeKey: `${rule.ruleCode}:behaviour:${anomaly.flow.userId}:${anomaly.flow.id}`,
      evidence: {
        baseline,
        flow: {
          id: anomaly.flow.id,
          direction: anomaly.flow.direction,
          amountUsd: anomaly.flow.amountUsd,
          at: anomaly.flow.at.toISOString(),
          source: anomaly.flow.source,
          dealId: anomaly.flow.dealId,
        },
        amountZScore: Math.round(anomaly.amountZScore * 100) / 100,
        cadenceZScore:
          anomaly.cadenceZScore === null
            ? null
            : Math.round(anomaly.cadenceZScore * 100) / 100,
        newCountry: anomaly.newCountry,
      },
      amountUsd: anomaly.flow.amountUsd,
      flowIds: [anomaly.flow.id],
    };
  });
}
