import {
  REQUIRED_PARAMETERS,
  detectHighRiskJurisdiction,
  detectHighValue,
  detectLayering,
  detectRapidMovement,
  detectStructuring,
  detectVelocity,
  effectiveRiskScore,
  runDetector,
} from './aml-detectors';
import * as behavioural from './aml-behavioral';
import { CashFlow, PatternMatch } from './aml.constants';
import { AmlMonitoringRule } from './entities/aml-monitoring-rule.entity';

const HOUR_MS = 3_600_000;
const DAY_ONE = Date.UTC(2026, 0, 1);

const atHour = (hour: number): Date => new Date(DAY_ONE + hour * HOUR_MS);

const makeFlow = (overrides: Partial<CashFlow> = {}): CashFlow => ({
  id: 'f1',
  userId: 'u1',
  direction: 'in',
  amountUsd: 1_000,
  at: atHour(0),
  dealId: 'd1',
  source: 'investments',
  counterpartyCountry: null,
  ...overrides,
});

const makeRule = (
  overrides: Partial<AmlMonitoringRule> = {},
): AmlMonitoringRule =>
  ({
    id: 'rule-1',
    ruleCode: 'AML-TEST-001',
    patternType: 'STRUCTURING',
    riskLevel: 'MEDIUM',
    action: 'FLAG_REVIEW',
    enabled: true,
    windowHours: 24,
    parameters: {},
    baseRiskScore: 50,
    alertThresholdScore: 40,
    sensitivityMultiplier: 1,
    ...overrides,
  }) as AmlMonitoringRule;

describe('effectiveRiskScore', () => {
  it('multiplies the base score by the false-positive sensitivity', () => {
    expect(
      effectiveRiskScore({ baseRiskScore: 80, sensitivityMultiplier: 0.5 }),
    ).toBe(40);
  });

  it('coerces decimal strings coming out of Postgres', () => {
    expect(
      effectiveRiskScore({
        baseRiskScore: '80' as unknown as number,
        sensitivityMultiplier: '0.5' as unknown as number,
      }),
    ).toBe(40);
  });

  it('falls back to a mid-strength rule when the score is unusable', () => {
    expect(
      effectiveRiskScore({
        baseRiskScore: Number.NaN,
        sensitivityMultiplier: undefined,
      }),
    ).toBe(50);
  });

  it('clamps into the 0-100 band and rounds to two decimals', () => {
    expect(
      effectiveRiskScore(
        { baseRiskScore: 90, sensitivityMultiplier: 1.25 },
        0.75,
      ),
    ).toBe(100);
    expect(
      effectiveRiskScore({ baseRiskScore: -10, sensitivityMultiplier: 1 }),
    ).toBe(0);
    expect(
      effectiveRiskScore({ baseRiskScore: 12.345, sensitivityMultiplier: 1 }),
    ).toBe(12.35);
  });

  it('lifts the score with the magnitude of the movement', () => {
    const base = effectiveRiskScore({
      baseRiskScore: 50,
      sensitivityMultiplier: 1,
    });
    expect(
      effectiveRiskScore({ baseRiskScore: 50, sensitivityMultiplier: 1 }, 0.2),
    ).toBeGreaterThan(base);
  });
});

describe('detectStructuring', () => {
  const rule = makeRule({
    patternType: 'STRUCTURING',
    parameters: {
      maxIndividualAmountUsd: 9_500,
      aggregateThresholdUsd: 10_000,
      minFlowCount: 3,
    },
  });

  it('fires once per bucket of sub-threshold deposits that reaches the threshold', () => {
    const flows = [1, 2, 3, 4].map((index) =>
      makeFlow({ id: `s${index}`, amountUsd: 3_000, at: atHour(index) }),
    );
    const matches = detectStructuring(rule, flows);
    expect(matches).toHaveLength(1);
    expect(matches[0].patternType).toBe('STRUCTURING');
    expect(matches[0].amountUsd).toBe(12_000);
    expect(matches[0].title).toBe(
      '4 sub-threshold deposits totalling $12000.00',
    );
    expect(matches[0].riskScore).toBeCloseTo(50.99, 2);
    expect(matches[0].evidence).toMatchObject({
      maxIndividualAmountUsd: 9_500,
      aggregateThresholdUsd: 10_000,
      flowCount: 4,
      totalUsd: 12_000,
    });
    expect(matches[0].flowIds).toEqual(['s1', 's2', 's3', 's4']);
    expect(matches[0].reason).toContain('within 24h');
  });

  it('ignores outflows and deposits above the per-transfer ceiling', () => {
    const flows = [
      makeFlow({ id: 'a', amountUsd: 3_000, at: atHour(1) }),
      makeFlow({ id: 'b', amountUsd: 3_000, at: atHour(2) }),
      makeFlow({ id: 'c', amountUsd: 3_000, at: atHour(3) }),
      makeFlow({ id: 'd', amountUsd: 9_600, at: atHour(4) }),
      makeFlow({ id: 'e', amountUsd: 3_000, direction: 'out', at: atHour(5) }),
    ];
    expect(detectStructuring(rule, flows)).toEqual([]);
  });

  it('respects the configured minimum count', () => {
    const strict = makeRule({
      patternType: 'STRUCTURING',
      parameters: {
        maxIndividualAmountUsd: 9_500,
        aggregateThresholdUsd: 10_000,
        minFlowCount: 5,
      },
    });
    const flows = [1, 2, 3, 4].map((index) =>
      makeFlow({ id: `s${index}`, amountUsd: 3_000, at: atHour(index) }),
    );
    expect(detectStructuring(strict, flows)).toEqual([]);
  });

  it('raises a single alert even when several overlapping windows qualify', () => {
    const flows = [1, 2, 3, 4, 5].map((index) =>
      makeFlow({ id: `s${index}`, amountUsd: 3_000, at: atHour(index) }),
    );
    const matches = detectStructuring(rule, flows);
    expect(matches).toHaveLength(1);
    expect(matches[0].evidence.flowCount).toBe(5);
    expect(matches[0].amountUsd).toBe(15_000);
  });

  it('separates subjects and reporting buckets', () => {
    const flows = [
      ...[1, 2, 3].map((index) =>
        makeFlow({
          id: `a${index}`,
          userId: 'uA',
          amountUsd: 4_000,
          at: atHour(index),
        }),
      ),
      ...[4, 5, 6].map((index) =>
        makeFlow({
          id: `b${index}`,
          userId: 'uB',
          amountUsd: 4_000,
          at: atHour(index),
        }),
      ),
    ];
    const matches = detectStructuring(
      makeRule({
        patternType: 'STRUCTURING',
        windowHours: 3,
        parameters: {
          maxIndividualAmountUsd: 9_500,
          aggregateThresholdUsd: 10_000,
          minFlowCount: 3,
        },
      }),
      flows,
    );
    const users = matches.map((match) => match.dedupeKey.split(':')[3]);
    expect(new Set(users).size).toBe(2);
  });
});

describe('detectRapidMovement', () => {
  const rule = makeRule({
    patternType: 'RAPID_MOVEMENT',
    parameters: { movementRatio: 0.9, minInflowUsd: 1_000 },
  });

  it('fires when almost everything that came in went straight back out', () => {
    const flows = [
      makeFlow({ id: 'in1', amountUsd: 5_000, at: atHour(0) }),
      makeFlow({
        id: 'out1',
        amountUsd: 4_800,
        direction: 'out',
        at: atHour(1),
      }),
    ];
    const matches = detectRapidMovement(rule, flows);
    expect(matches).toHaveLength(1);
    expect(matches[0].patternType).toBe('RAPID_MOVEMENT');
    expect(matches[0].dedupeKey).toBe('AML-TEST-001:rapid-movement:u1:in1');
    expect(matches[0].amountUsd).toBe(5_000);
    expect(matches[0].evidence).toMatchObject({
      inflowUsd: 5_000,
      outflowUsd: 4_800,
      utilization: 0.96,
      movementRatio: 0.9,
    });
    expect(matches[0].reason).toContain('96% of the funds received');
  });

  it('stays quiet when the account actually invested the money', () => {
    const flows = [
      makeFlow({ id: 'in1', amountUsd: 5_000, at: atHour(0) }),
      makeFlow({
        id: 'out1',
        amountUsd: 2_000,
        direction: 'out',
        at: atHour(1),
      }),
    ];
    expect(detectRapidMovement(rule, flows)).toEqual([]);
  });

  it('ignores inflows below its own minimum', () => {
    const flows = [
      makeFlow({ id: 'in1', amountUsd: 500, at: atHour(0) }),
      makeFlow({ id: 'out1', amountUsd: 500, direction: 'out', at: atHour(1) }),
    ];
    expect(detectRapidMovement(rule, flows)).toEqual([]);
  });

  it('only counts outflows inside the window', () => {
    const flows = [
      makeFlow({ id: 'in1', amountUsd: 5_000, at: atHour(0) }),
      makeFlow({
        id: 'out1',
        amountUsd: 5_000,
        direction: 'out',
        at: atHour(30),
      }),
    ];
    expect(detectRapidMovement(rule, flows)).toEqual([]);
  });
});

describe('detectLayering', () => {
  const rule = makeRule({
    patternType: 'LAYERING',
    parameters: { minDistinctDeals: 3, minFlowCount: 4 },
  });

  it('fires on funds pushed through several deals with direction changes', () => {
    const flows = [
      makeFlow({ id: 'l1', dealId: 'd1', amountUsd: 1_000, at: atHour(0) }),
      makeFlow({
        id: 'l2',
        dealId: 'd2',
        amountUsd: 1_000,
        direction: 'out',
        at: atHour(1),
      }),
      makeFlow({ id: 'l3', dealId: 'd3', amountUsd: 1_000, at: atHour(2) }),
      makeFlow({
        id: 'l4',
        dealId: 'd4',
        amountUsd: 1_000,
        direction: 'out',
        at: atHour(3),
      }),
    ];
    const matches = detectLayering(rule, flows);
    expect(matches).toHaveLength(1);
    expect(matches[0].patternType).toBe('LAYERING');
    expect(matches[0].title).toBe('4 movements across 4 deals in 24h');
    expect(matches[0].evidence).toMatchObject({
      minDistinctDeals: 3,
      directionChanges: 3,
      distinctDealIds: ['d1', 'd2', 'd3', 'd4'],
    });
    expect(matches[0].reason).toContain('matching a layering pattern');
  });

  it('needs the flows to actually change direction', () => {
    const flows = [0, 1, 2, 3].map((index) =>
      makeFlow({
        id: `l${index}`,
        dealId: `d${index}`,
        amountUsd: 1_000,
        at: atHour(index),
      }),
    );
    expect(detectLayering(rule, flows)).toEqual([]);
  });

  it('needs the configured number of distinct deals', () => {
    const flows = [
      makeFlow({ id: 'l1', dealId: 'd1', at: atHour(0) }),
      makeFlow({ id: 'l2', dealId: 'd1', direction: 'out', at: atHour(1) }),
      makeFlow({ id: 'l3', dealId: 'd1', at: atHour(2) }),
      makeFlow({ id: 'l4', dealId: 'd2', direction: 'out', at: atHour(3) }),
    ];
    expect(detectLayering(rule, flows)).toEqual([]);
  });
});

describe('detectVelocity', () => {
  const rule = makeRule({
    patternType: 'VELOCITY',
    parameters: { maxFlowsPerWindow: 3 },
  });

  it('fires once the window holds more movements than the limit', () => {
    const flows = [1, 2, 3, 4, 5].map((index) =>
      makeFlow({ id: `v${index}`, amountUsd: 100, at: atHour(index) }),
    );
    const matches = detectVelocity(rule, flows);
    expect(matches).toHaveLength(1);
    expect(matches[0].title).toBe('5 movements in 24h');
    expect(matches[0].reason).toContain('against a limit of 3');
    expect(matches[0].evidence).toMatchObject({
      maxFlowsPerWindow: 3,
      flowCount: 5,
    });
  });

  it('does not fire at the limit itself', () => {
    const flows = [1, 2, 3].map((index) =>
      makeFlow({ id: `v${index}`, amountUsd: 100, at: atHour(index) }),
    );
    expect(detectVelocity(rule, flows)).toEqual([]);
  });
});

describe('detectHighValue', () => {
  const rule = makeRule({
    patternType: 'HIGH_VALUE',
    parameters: { amountThresholdUsd: 50_000 },
  });

  it('flags each movement at or above the ceiling', () => {
    const flows = [
      makeFlow({ id: 'h1', amountUsd: 40_000 }),
      makeFlow({ id: 'h2', amountUsd: 50_000 }),
      makeFlow({ id: 'h3', amountUsd: 60_000, direction: 'out' }),
    ];
    const matches = detectHighValue(rule, flows);
    expect(matches.map((match) => match.flowIds)).toEqual([['h2'], ['h3']]);
    expect(matches[0].riskScore).toBe(50);
    expect(matches[0].reason).toContain('inflow');
    expect(matches[1].reason).toContain('outflow');
    expect(matches[1].riskScore).toBeGreaterThan(matches[0].riskScore);
    expect(matches[0].dedupeKey).toBe('AML-TEST-001:high-value:h2');
    expect(matches[0].evidence).toMatchObject({ amountThresholdUsd: 50_000 });
  });

  it('uses the single-flow evidence block', () => {
    const [match] = detectHighValue(rule, [
      makeFlow({ id: 'h2', amountUsd: 50_000 }),
    ] as CashFlow[]);
    const evidence = match.evidence.flow as Record<string, unknown>;
    expect(evidence).toMatchObject({
      id: 'h2',
      amountUsd: 50_000,
      source: 'investments',
    });
  });
});

describe('detectHighRiskJurisdiction', () => {
  const rule = makeRule({
    patternType: 'HIGH_RISK_JURISDICTION',
    parameters: { countries: ['IR', 'kp'] },
  });

  it('returns nothing without a watchlist', () => {
    expect(
      detectHighRiskJurisdiction(makeRule({ parameters: { countries: [] } }), [
        makeFlow({ counterpartyCountry: 'IR' }),
      ]),
    ).toEqual([]);
  });

  it('matches both the account country and the counterparty country', () => {
    const flows = [
      makeFlow({ id: 'j1', counterpartyCountry: 'IR', amountUsd: 500 }),
      makeFlow({ id: 'j2', counterpartyCountry: 'US', amountUsd: 500 }),
      makeFlow({ id: 'j3', counterpartyCountry: null, amountUsd: 500 }),
    ];
    const matches = detectHighRiskJurisdiction(rule, flows, {
      userCountry: 'ir',
    });
    expect(matches).toHaveLength(2);
    expect(matches[0].evidence).toMatchObject({
      matchedOn: 'user_country',
      userCountry: 'IR',
    });
    expect(matches[0].amountUsd).toBe(1_500);
    expect(matches[1].dedupeKey).toBe('AML-TEST-001:counterparty:u1:IR');
    expect(matches[1].title).toBe('Movement involving IR');
  });

  it('is case and accent insensitive about the list itself', () => {
    const matches = detectHighRiskJurisdiction(
      makeRule({ parameters: { countries: ['kp'] } }),
      [makeFlow({ id: 'j1', counterpartyCountry: 'KP' })],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].evidence).toMatchObject({
      matchedOn: 'counterparty_country',
    });
  });

  it('still reports an account in a flagged country with no flows', () => {
    const matches = detectHighRiskJurisdiction(rule, [], { userCountry: 'IR' });
    expect(matches).toHaveLength(1);
    expect(matches[0].dedupeKey).toContain('unknown:IR');
  });
});

describe('runDetector', () => {
  const flows = [
    makeFlow({ id: 'a', amountUsd: 3_000, at: atHour(0) }),
    makeFlow({ id: 'b', amountUsd: 3_000, at: atHour(1) }),
    makeFlow({ id: 'c', amountUsd: 3_000, at: atHour(2) }),
    makeFlow({ id: 'd', amountUsd: 3_000, at: atHour(3) }),
  ];

  it('does nothing for a disabled rule or an empty ledger', () => {
    const rule = makeRule({
      enabled: false,
      parameters: {
        maxIndividualAmountUsd: 9_500,
        aggregateThresholdUsd: 10_000,
        minFlowCount: 3,
      },
    });
    expect(runDetector(rule, flows)).toEqual([]);
    expect(
      runDetector(makeRule({ parameters: { amountThresholdUsd: 1 } }), []),
    ).toEqual([]);
  });

  it('dispatches to the detector for the pattern', () => {
    const structuring = makeRule({
      patternType: 'STRUCTURING',
      parameters: {
        maxIndividualAmountUsd: 9_500,
        aggregateThresholdUsd: 10_000,
        minFlowCount: 3,
      },
    });
    const [match] = runDetector(structuring, flows);
    expect(match.patternType).toBe('STRUCTURING');

    const highValue = makeRule({
      patternType: 'HIGH_VALUE',
      parameters: { amountThresholdUsd: 1 },
    });
    expect(rundetectorCount(highValue, flows)).toBe(4);

    const velocity = makeRule({
      patternType: 'VELOCITY',
      parameters: { maxFlowsPerWindow: 1 },
    });
    expect(rundetectorCount(velocity, flows)).toBeGreaterThan(0);

    const rapid = makeRule({
      patternType: 'RAPID_MOVEMENT',
      parameters: { movementRatio: 0.9, minInflowUsd: 1 },
    });
    expect(rundetectorCount(rapid, flows)).toBe(0);

    const layering = makeRule({
      patternType: 'LAYERING',
      parameters: { minDistinctDeals: 1, minFlowCount: 2 },
    });
    expect(rundetectorCount(layering, flows)).toBe(0);
  });

  it('hands behavioural rules to the baseline detector', () => {
    const spy = jest
      .spyOn(behavioural, 'detectBehaviouralAnomalies')
      .mockReturnValue([] as PatternMatch[]);
    const rule = makeRule({
      patternType: 'BEHAVIORAL_ANOMALY',
      parameters: { zScoreThreshold: 3 },
    });
    expect(runDetector(rule, flows)).toEqual([]);
    expect(spy).toHaveBeenCalledWith(rule, flows);
    spy.mockRestore();
  });

  it('survives a pattern it does not know instead of aborting the sweep', () => {
    const rule = makeRule({
      patternType: 'SANCTIONS_MATCH' as CashFlow['direction'] &
        AmlMonitoringRule['patternType'],
    });
    expect(runDetector(rule, flows)).toEqual([]);
  });
});

function rundetectorCount(rule: AmlMonitoringRule, flows: CashFlow[]): number {
  return runDetector(rule, flows).length;
}

describe('REQUIRED_PARAMETERS', () => {
  it('lists the keys each behavioural pattern needs', () => {
    expect(REQUIRED_PARAMETERS.STRUCTURING).toEqual([
      'aggregateThresholdUsd',
      'maxIndividualAmountUsd',
      'minFlowCount',
    ]);
    expect(REQUIRED_PARAMETERS.RAPID_MOVEMENT).toEqual([
      'movementRatio',
      'minInflowUsd',
    ]);
    expect(REQUIRED_PARAMETERS.HIGH_RISK_JURISDICTION).toEqual(['countries']);
    expect(REQUIRED_PARAMETERS.BEHAVIORAL_ANOMALY).toEqual(['zScoreThreshold']);
  });

  it('has no required keys for patterns that screen rather than sweep', () => {
    expect(REQUIRED_PARAMETERS.SANCTIONS_MATCH).toBeUndefined();
    expect(REQUIRED_PARAMETERS.PEP_MATCH).toBeUndefined();
  });
});
