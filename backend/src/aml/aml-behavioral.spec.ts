import {
  buildBaseline,
  detectBehaviouralAnomalies,
  findBehaviouralAnomalies,
  stddev,
  zScore,
} from './aml-behavioral';
import { CashFlow } from './aml.constants';
import { AmlMonitoringRule } from './entities/aml-monitoring-rule.entity';

const HOUR_MS = 3_600_000;
const BASE = Date.UTC(2026, 0, 1);

const atHour = (hour: number): Date => new Date(BASE + hour * HOUR_MS);

const makeFlow = (overrides: Partial<CashFlow> = {}): CashFlow => ({
  id: 'f1',
  userId: 'u1',
  direction: 'in',
  amountUsd: 400,
  at: atHour(0),
  dealId: 'd1',
  source: 'investments',
  counterpartyCountry: 'KE',
  ...overrides,
});

const makeRule = (
  overrides: Partial<AmlMonitoringRule> = {},
): AmlMonitoringRule =>
  ({
    id: 'rule-beh',
    ruleCode: 'AML-BEH-001',
    patternType: 'BEHAVIORAL_ANOMALY',
    riskLevel: 'HIGH',
    action: 'FLAG_REVIEW',
    enabled: true,
    windowHours: 24,
    parameters: {},
    baseRiskScore: 50,
    alertThresholdScore: 40,
    sensitivityMultiplier: 1,
    ...overrides,
  }) as AmlMonitoringRule;

/**
 * Eight alternating historical movements (mean $400, sample sd ~106.9, 24h
 * cadence) followed by five recent movements, the last of which is an outlier
 * into a country the account has never dealt with.
 */
const historyFlows = [300, 500, 300, 500, 300, 500, 300, 500].map(
  (amountUsd, index) =>
    makeFlow({
      id: `h${index + 1}`,
      amountUsd,
      at: atHour(index * 24),
    }),
);

const recentFlows = [400, 400, 400, 400, 18_000].map((amountUsd, index) =>
  makeFlow({
    id: `r${index + 1}`,
    amountUsd,
    at: atHour(192 + index * 24),
    counterpartyCountry: index === 4 ? 'AE' : 'KE',
  }),
);

const spikeSeries = [...historyFlows, ...recentFlows];

/** Flat amounts, irregular cadence, then a 60h gap. */
const cadenceFlows = [
  ...[0, 2, 6, 12, 20, 30, 42, 56].map((hour, index) =>
    makeFlow({ id: `c${index + 1}`, amountUsd: 400, at: atHour(hour) }),
  ),
  ...[57, 58, 59, 60, 120].map((hour, index) =>
    makeFlow({ id: `k${index + 1}`, amountUsd: 400, at: atHour(hour) }),
  ),
];

describe('stddev', () => {
  it('is zero for fewer than two samples', () => {
    expect(stddev([])).toBe(0);
    expect(stddev([7])).toBe(0);
  });

  it('uses the sample (n-1) denominator', () => {
    expect(stddev([1, 2, 3, 4])).toBeCloseTo(1.291, 3);
  });
});

describe('zScore', () => {
  it('guards against a zero or negative spread', () => {
    expect(zScore(10, 5, 0)).toBe(0);
    expect(zScore(10, 5, -2)).toBe(0);
  });

  it('measures distance from the mean in spreads', () => {
    expect(zScore(10, 5, 2.5)).toBe(2);
    expect(zScore(2, 5, 1.5)).toBe(-2);
  });
});

describe('buildBaseline', () => {
  it('describes the historical part of the series only', () => {
    const baseline = buildBaseline(spikeSeries, 5);
    expect(baseline.sampleCount).toBe(8);
    expect(baseline.meanAmountUsd).toBe(400);
    expect(baseline.stddevAmountUsd).toBeCloseTo(106.9, 1);
    expect(baseline.meanIntervalHours).toBe(24);
    expect(baseline.stddevIntervalHours).toBe(0);
    expect(baseline.knownCountries).toEqual(['KE']);
  });

  it('reports the span of the whole series, including the recent tail', () => {
    const baseline = buildBaseline(spikeSeries, 5);
    expect(baseline.firstFlowAt).toBe(atHour(0).toISOString());
    expect(baseline.lastFlowAt).toBe(atHour(288).toISOString());
  });

  it('handles an empty series without dividing by zero', () => {
    expect(buildBaseline([])).toEqual({
      sampleCount: 0,
      meanAmountUsd: 0,
      stddevAmountUsd: 0,
      meanIntervalHours: 0,
      stddevIntervalHours: 0,
      knownCountries: [],
      firstFlowAt: null,
      lastFlowAt: null,
    });
  });

  it('ignores non-positive amounts when averaging but still counts the row', () => {
    const flows = [
      makeFlow({ id: 'a', amountUsd: 0, at: atHour(0) }),
      makeFlow({ id: 'b', amountUsd: 300, at: atHour(1) }),
      makeFlow({ id: 'c', amountUsd: 500, at: atHour(2) }),
      makeFlow({ id: 'd', amountUsd: 300, at: atHour(3) }),
      makeFlow({ id: 'e', amountUsd: 900, at: atHour(4) }),
      makeFlow({ id: 'f', amountUsd: 900, at: atHour(5) }),
    ];
    const baseline = buildBaseline(flows, 2);
    expect(baseline.sampleCount).toBe(4);
    expect(baseline.meanAmountUsd).toBeCloseTo(366.67, 2);
  });
});

describe('findBehaviouralAnomalies', () => {
  it('flags the outlier movement on both amount and new jurisdiction', () => {
    const { baseline, anomalies } = findBehaviouralAnomalies(spikeSeries);
    expect(baseline.sampleCount).toBe(8);
    expect(anomalies).toHaveLength(1);
    const [anomaly] = anomalies;
    expect(anomaly.flow.id).toBe('r5');
    expect(anomaly.newCountry).toBe('AE');
    expect(anomaly.amountZScore).toBeCloseTo(164.64, 2);
    expect(anomaly.cadenceZScore).toBe(0);
    expect(anomaly.reasons).toEqual([
      expect.stringContaining('18000.00'),
      'first movement involving AE',
    ]);
    expect(anomaly.reasons[0]).toContain(
      "standard deviations above this account's mean of $400.00",
    );
  });

  it('refuses to profile an account without enough history', () => {
    const short = historyFlows.slice(0, 4);
    const { baseline, anomalies } = findBehaviouralAnomalies(short);
    expect(baseline.sampleCount).toBe(0);
    expect(anomalies).toEqual([]);
  });

  it('honours a higher minHistorySamples', () => {
    const { anomalies } = findBehaviouralAnomalies(spikeSeries, {
      minHistorySamples: 12,
    });
    expect(anomalies).toEqual([]);
  });

  it('honours a threshold the outlier no longer clears', () => {
    const { anomalies } = findBehaviouralAnomalies(spikeSeries, {
      zScoreThreshold: 200,
    });
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].reasons).toEqual(['first movement involving AE']);
  });

  it('detects an out-of-pattern gap in activity', () => {
    const { baseline, anomalies } = findBehaviouralAnomalies(cadenceFlows, {
      zScoreThreshold: 3,
    });
    expect(baseline.meanIntervalHours).toBe(8);
    expect(baseline.stddevIntervalHours).toBeCloseTo(4.32, 2);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].flow.id).toBe('k5');
    expect(anomalies[0].amountZScore).toBe(0);
    expect(anomalies[0].cadenceZScore).toBeCloseTo(12.04, 2);
    expect(anomalies[0].reasons[0]).toContain('usual 8h cadence');
  });

  it('scores only the tail of the series when recentCount changes', () => {
    const { baseline, anomalies } = findBehaviouralAnomalies(spikeSeries, {
      recentCount: 1,
    });
    expect(baseline.sampleCount).toBe(12);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].flow.id).toBe('r5');
  });
});

describe('detectBehaviouralAnomalies', () => {
  it('builds an explainable match around the account baseline', () => {
    const [match] = detectBehaviouralAnomalies(makeRule(), spikeSeries);
    expect(match.patternType).toBe('BEHAVIORAL_ANOMALY');
    expect(match.ruleCode).toBe('AML-BEH-001');
    expect(match.severity).toBe('HIGH');
    expect(match.dedupeKey).toBe('AML-BEH-001:behaviour:u1:r5');
    expect(match.title).toBe('Unusual inflow of $18000.00');
    expect(match.reason).toContain(
      'Account behaviour baseline (8 historical movements, mean $400',
    );
    expect(match.amountUsd).toBe(18_000);
    expect(match.flowIds).toEqual(['r5']);
    expect(match.evidence.baseline).toMatchObject({ sampleCount: 8 });
    expect(match.evidence.newCountry).toBe('AE');
    // A brand-new jurisdiction is evidence on its own: fixed 20% uplift.
    expect(match.riskScore).toBe(60);
  });

  it('scales a pure amount spike by how far outside the spread it sits', () => {
    const sameButKnown = [
      ...historyFlows,
      ...recentFlows.map((flow) => ({ ...flow, counterpartyCountry: 'KE' })),
    ];
    const [match] = detectBehaviouralAnomalies(makeRule(), sameButKnown);
    expect(match.evidence.newCountry).toBeNull();
    expect(match.riskScore).toBe(87.5);
  });

  it('applies the rule sensitivity multiplier', () => {
    const quiet = makeRule({ sensitivityMultiplier: 0.4 });
    const [match] = detectBehaviouralAnomalies(quiet, spikeSeries);
    expect(match.riskScore).toBe(24);
  });

  it('reads its parameters off the rule', () => {
    const strict = makeRule({
      parameters: {
        zScoreThreshold: 500,
        minHistorySamples: 5,
        recentCount: 5,
      },
    });
    expect(detectBehaviouralAnomalies(strict, spikeSeries)).toHaveLength(1);
    const hungry = makeRule({ parameters: { minHistorySamples: 40 } });
    expect(detectBehaviouralAnomalies(hungry, spikeSeries)).toEqual([]);
  });

  it('stays quiet for an account that only ever moves the same amount', () => {
    const flat = Array.from({ length: 13 }, (_ignored, index) =>
      makeFlow({ id: `f${index}`, amountUsd: 400, at: atHour(index * 24) }),
    );
    expect(detectBehaviouralAnomalies(makeRule(), flat)).toEqual([]);
  });
});
