import { AmlPatternType, CashFlow, PatternMatch } from './aml.constants';
import { detectBehaviouralAnomalies } from './aml-behavioral';
import { AmlMonitoringRule } from './entities/aml-monitoring-rule.entity';

/**
 * Pure detectors for #1217. They take an already-projected list of money
 * movements plus a rule's parameters and return matches, so the pattern logic
 * is testable without a database and shared by the sweep and the single
 * transaction path.
 */

export interface DetectorContext {
  userCountry?: string | null;
}

const HOUR_MS = 3_600_000;

function num(raw: unknown, fallback: number): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function clampScore(score: number): number {
  return Math.round(Math.min(100, Math.max(0, score)) * 100) / 100;
}

/** Effective score = base score, tuned by false-positive history and magnitude. */
export function effectiveRiskScore(
  rule: Pick<AmlMonitoringRule, 'baseRiskScore' | 'sensitivityMultiplier'>,
  magnitudeBoost = 0,
): number {
  const base = num(rule.baseRiskScore, 50);
  const sensitivity = num(rule.sensitivityMultiplier, 1);
  return clampScore(base * sensitivity * (1 + magnitudeBoost));
}

function magnitudeBoost(amountUsd: number, thresholdUsd: number): number {
  if (thresholdUsd <= 0 || amountUsd <= thresholdUsd) return 0;
  // Log-scaled severity: 10x over threshold is +0.25, 100x is +0.5, 1000x +0.75.
  return Math.min(0.75, 0.25 * Math.log10(amountUsd / thresholdUsd));
}

function windowStartLabel(flows: CashFlow[], windowHours: number): string {
  const earliest = flows[0]?.at;
  if (!earliest) return 'unknown';
  const bucketMs = Math.max(1, windowHours) * HOUR_MS;
  return new Date(
    Math.floor(earliest.getTime() / bucketMs) * bucketMs,
  ).toISOString();
}

/**
 * Sliding windows over `flows` where every member starts within `windowHours`
 * of the first member. Returns the densest qualifying window for each start.
 */
function windows(flows: CashFlow[], windowHours: number): Array<CashFlow[]> {
  const span = windowHours * HOUR_MS;
  const result: Array<CashFlow[]> = [];
  for (let start = 0; start < flows.length; start += 1) {
    const window: CashFlow[] = [];
    for (let i = start; i < flows.length; i += 1) {
      if (flows[i].at.getTime() - flows[start].at.getTime() > span) break;
      window.push(flows[i]);
    }
    if (window.length > 0) result.push(window);
  }
  return result;
}

function sumUsd(flows: CashFlow[]): number {
  return flows.reduce((total, flow) => total + flow.amountUsd, 0);
}

function distinctDeals(flows: CashFlow[]): string[] {
  const ids = new Set(
    flows.map((flow) => flow.dealId).filter(Boolean) as string[],
  );
  return [...ids];
}

function evidenceFor(flows: CashFlow[]): Record<string, unknown> {
  return {
    flowCount: flows.length,
    totalUsd: Math.round(sumUsd(flows) * 100) / 100,
    firstFlowAt: flows[0]?.at?.toISOString?.() ?? null,
    lastFlowAt: flows[flows.length - 1]?.at?.toISOString?.() ?? null,
    distinctDealIds: distinctDeals(flows),
    flows: flows.slice(0, 25).map((flow) => ({
      id: flow.id,
      direction: flow.direction,
      amountUsd: flow.amountUsd,
      at: flow.at.toISOString(),
      source: flow.source,
      dealId: flow.dealId,
    })),
  };
}

function match(
  rule: AmlMonitoringRule,
  patternType: AmlPatternType,
  options: {
    title: string;
    reason: string;
    dedupeKey: string;
    evidence: Record<string, unknown>;
    amountUsd: number;
    flowIds: string[];
    magnitudeBoost?: number;
  },
): PatternMatch {
  return {
    patternType,
    ruleId: rule.id,
    ruleCode: rule.ruleCode,
    severity: rule.riskLevel,
    action: rule.action,
    baseRiskScore: clampScore(num(rule.baseRiskScore, 50)),
    riskScore: effectiveRiskScore(rule, options.magnitudeBoost ?? 0),
    title: options.title,
    reason: options.reason,
    dedupeKey: options.dedupeKey,
    evidence: options.evidence,
    amountUsd: Math.round(options.amountUsd * 100) / 100,
    flowIds: options.flowIds,
  };
}

/**
 * Structuring: several deposits each at or below a reporting threshold that
 * together reach it inside one window (classic smurfing).
 */
export function detectStructuring(
  rule: AmlMonitoringRule,
  flows: CashFlow[],
): PatternMatch[] {
  const maxIndividual = num(rule.parameters?.maxIndividualAmountUsd, 9_500);
  const aggregate = num(rule.parameters?.aggregateThresholdUsd, 10_000);
  const minCount = num(rule.parameters?.minFlowCount, 3);
  const inFlows = flows
    .filter(
      (flow) => flow.direction === 'in' && flow.amountUsd <= maxIndividual,
    )
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const matches: PatternMatch[] = [];
  const seen = new Set<string>();
  for (const window of windows(inFlows, rule.windowHours)) {
    if (window.length < minCount) continue;
    const total = sumUsd(window);
    if (total < aggregate) continue;
    const dedupeKey = `${rule.ruleCode}:structuring:${window[0].userId}:${windowStartLabel(window, rule.windowHours)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    matches.push(
      match(rule, 'STRUCTURING', {
        title: `${window.length} sub-threshold deposits totalling $${total.toFixed(2)}`,
        reason: `${window.length} inflows of $${maxIndividual.toLocaleString()} or less moved a combined $${total.toLocaleString(
          'en-US',
        )} within ${rule.windowHours}h, reaching the $${aggregate.toLocaleString()} reporting threshold.`,
        dedupeKey,
        evidence: {
          maxIndividualAmountUsd: maxIndividual,
          aggregateThresholdUsd: aggregate,
          ...evidenceFor(window),
        },
        amountUsd: total,
        flowIds: window.map((flow) => flow.id),
        magnitudeBoost: magnitudeBoost(total, aggregate),
      }),
    );
  }
  return matches;
}

/**
 * Rapid movement: funds arriving are pushed back out almost immediately,
 * which is a pass-through / funnel-account signal rather than investing.
 */
export function detectRapidMovement(
  rule: AmlMonitoringRule,
  flows: CashFlow[],
): PatternMatch[] {
  const ratio = num(rule.parameters?.movementRatio, 0.9);
  const minInflow = num(rule.parameters?.minInflowUsd, 1_000);
  const ordered = [...flows].sort((a, b) => a.at.getTime() - b.at.getTime());

  const matches: PatternMatch[] = [];
  const seen = new Set<string>();
  for (const anchor of ordered.filter((flow) => flow.direction === 'in')) {
    const window = ordered.filter(
      (flow) =>
        flow.at.getTime() >= anchor.at.getTime() &&
        flow.at.getTime() - anchor.at.getTime() <= rule.windowHours * HOUR_MS,
    );
    const inflows = window.filter((flow) => flow.direction === 'in');
    const outflows = window.filter((flow) => flow.direction === 'out');
    const inTotal = sumUsd(inflows);
    const outTotal = sumUsd(outflows);
    if (inTotal < minInflow || outTotal < inTotal * ratio) continue;
    const dedupeKey = `${rule.ruleCode}:rapid-movement:${anchor.userId}:${anchor.id}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const utilization = outTotal / inTotal;
    matches.push(
      match(rule, 'RAPID_MOVEMENT', {
        title: `$${inTotal.toFixed(2)} in and $${outTotal.toFixed(2)} out within ${rule.windowHours}h`,
        reason: `${Math.round(utilization * 100)}% of the funds received in the window left again, at or above the ${(
          ratio * 100
        ).toFixed(0)}% pass-through ratio.`,
        dedupeKey,
        evidence: {
          movementRatio: ratio,
          minInflowUsd: minInflow,
          inflowUsd: Math.round(inTotal * 100) / 100,
          outflowUsd: Math.round(outTotal * 100) / 100,
          utilization: Math.round(utilization * 1000) / 1000,
          ...evidenceFor(window),
        },
        amountUsd: Math.max(inTotal, outTotal),
        flowIds: window.map((flow) => flow.id),
        magnitudeBoost: magnitudeBoost(inTotal, minInflow),
      }),
    );
  }
  return matches;
}

/**
 * Layering: funds are pushed through several distinct instruments before
 * leaving, obscuring the original source.
 */
export function detectLayering(
  rule: AmlMonitoringRule,
  flows: CashFlow[],
): PatternMatch[] {
  const minDeals = num(rule.parameters?.minDistinctDeals, 3);
  const minCount = num(rule.parameters?.minFlowCount, 4);
  const ordered = [...flows].sort((a, b) => a.at.getTime() - b.at.getTime());

  const matches: PatternMatch[] = [];
  const seen = new Set<string>();
  for (const window of windows(ordered, rule.windowHours)) {
    if (window.length < minCount) continue;
    const deals = distinctDeals(window);
    if (deals.length < minDeals) continue;
    const transitions = window.reduce(
      (count, flow, index) =>
        index > 0 && flow.direction !== window[index - 1].direction
          ? count + 1
          : count,
      0,
    );
    if (transitions < 2) continue;
    const userId = window[0].userId;
    const dedupeKey = `${rule.ruleCode}:layering:${userId}:${windowStartLabel(window, rule.windowHours)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    matches.push(
      match(rule, 'LAYERING', {
        title: `${window.length} movements across ${deals.length} deals in ${rule.windowHours}h`,
        reason: `Funds moved through ${deals.length} distinct deals with ${transitions} in/out direction changes inside ${rule.windowHours}h, matching a layering pattern.`,
        dedupeKey,
        evidence: {
          minDistinctDeals: minDeals,
          directionChanges: transitions,
          ...evidenceFor(window),
        },
        amountUsd: sumUsd(window),
        flowIds: window.map((flow) => flow.id),
        magnitudeBoost: magnitudeBoost(deals.length, minDeals),
      }),
    );
  }
  return matches;
}

/** Velocity: an unusually high number of movements in a short window. */
export function detectVelocity(
  rule: AmlMonitoringRule,
  flows: CashFlow[],
): PatternMatch[] {
  const maxFlows = num(rule.parameters?.maxFlowsPerWindow, 10);
  const ordered = [...flows].sort((a, b) => a.at.getTime() - b.at.getTime());
  const matches: PatternMatch[] = [];
  const seen = new Set<string>();
  for (const window of windows(ordered, rule.windowHours)) {
    if (window.length <= maxFlows) continue;
    const dedupeKey = `${rule.ruleCode}:velocity:${window[0].userId}:${windowStartLabel(window, rule.windowHours)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    matches.push(
      match(rule, 'VELOCITY', {
        title: `${window.length} movements in ${rule.windowHours}h`,
        reason: `${window.length} money movements were recorded inside ${rule.windowHours}h against a limit of ${maxFlows}.`,
        dedupeKey,
        evidence: { maxFlowsPerWindow: maxFlows, ...evidenceFor(window) },
        amountUsd: sumUsd(window),
        flowIds: window.map((flow) => flow.id),
        magnitudeBoost: magnitudeBoost(window.length, maxFlows),
      }),
    );
  }
  return matches;
}

/** High value: a single movement at or above the configured ceiling. */
export function detectHighValue(
  rule: AmlMonitoringRule,
  flows: CashFlow[],
): PatternMatch[] {
  const threshold = num(rule.parameters?.amountThresholdUsd, 50_000);
  const matches: PatternMatch[] = [];
  for (const flow of flows) {
    if (flow.amountUsd < threshold) continue;
    matches.push(
      match(rule, 'HIGH_VALUE', {
        title: `$${flow.amountUsd.toFixed(2)} single movement`,
        reason: `A single ${flow.direction === 'in' ? 'inflow' : 'outflow'} of $${flow.amountUsd.toLocaleString(
          'en-US',
        )} met or exceeded the $${threshold.toLocaleString('en-US')} reporting threshold.`,
        dedupeKey: `${rule.ruleCode}:high-value:${flow.id}`,
        evidence: {
          amountThresholdUsd: threshold,
          flow: evidenceFor([flow]).flows[0],
        },
        amountUsd: flow.amountUsd,
        flowIds: [flow.id],
        magnitudeBoost: magnitudeBoost(flow.amountUsd, threshold),
      }),
    );
  }
  return matches;
}

/** High risk jurisdiction: the account or the counterparty sits in a flagged country. */
export function detectHighRiskJurisdiction(
  rule: AmlMonitoringRule,
  flows: CashFlow[],
  context: DetectorContext = {},
): PatternMatch[] {
  const countries = (rule.parameters?.countries ?? []).map((country) =>
    String(country).toUpperCase(),
  );
  if (countries.length === 0) return [];
  const matches: PatternMatch[] = [];
  const seen = new Set<string>();
  const userCountry = (context.userCountry ?? '').toUpperCase();

  const flagged = flows.filter((flow) =>
    (flow.counterpartyCountry ?? '').toUpperCase()
      ? countries.includes((flow.counterpartyCountry ?? '').toUpperCase())
      : false,
  );
  if (userCountry && countries.includes(userCountry)) {
    const dedupeKey = `${rule.ruleCode}:jurisdiction:${flows[0]?.userId ?? 'unknown'}:${userCountry}`;
    matches.push(
      match(rule, 'HIGH_RISK_JURISDICTION', {
        title: `Account registered in ${userCountry}`,
        reason: `The account's country ${userCountry} is on the rule's high-risk list.`,
        dedupeKey,
        evidence: { countries, matchedOn: 'user_country', userCountry },
        amountUsd: sumUsd(flows),
        flowIds: flows.map((flow) => flow.id),
      }),
    );
    seen.add(dedupeKey);
  }
  for (const flow of flagged) {
    const country = (flow.counterpartyCountry ?? '').toUpperCase();
    const dedupeKey = `${rule.ruleCode}:counterparty:${flow.userId}:${country}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    matches.push(
      match(rule, 'HIGH_RISK_JURISDICTION', {
        title: `Movement involving ${country}`,
        reason: `A ${flow.direction} flow is linked to deal counterparty country ${country}, which is on the rule's high-risk list.`,
        dedupeKey,
        evidence: {
          countries,
          matchedOn: 'counterparty_country',
          flow: evidenceFor([flow]).flows[0],
        },
        amountUsd: flow.amountUsd,
        flowIds: [flow.id],
      }),
    );
  }
  return matches;
}

/**
 * Runs the detector that belongs to the rule's pattern. Unknown patterns yield
 * no matches rather than throwing, so one bad rule cannot abort a sweep.
 */
export function runDetector(
  rule: AmlMonitoringRule,
  flows: CashFlow[],
  context: DetectorContext = {},
): PatternMatch[] {
  if (!rule.enabled) return [];
  if (flows.length === 0) return [];
  switch (rule.patternType) {
    case 'STRUCTURING':
      return detectStructuring(rule, flows);
    case 'RAPID_MOVEMENT':
      return detectRapidMovement(rule, flows);
    case 'LAYERING':
      return detectLayering(rule, flows);
    case 'VELOCITY':
      return detectVelocity(rule, flows);
    case 'HIGH_VALUE':
      return detectHighValue(rule, flows);
    case 'HIGH_RISK_JURISDICTION':
      return detectHighRiskJurisdiction(rule, flows, context);
    case 'BEHAVIORAL_ANOMALY':
      return detectBehaviouralAnomalies(rule, flows);
    default:
      return [];
  }
}

/**
 * Keys each pattern needs, with defaults applied when a rule omits them. Used
 * by the rules service to reject parameters that cannot drive the detector.
 */
export const REQUIRED_PARAMETERS: Partial<Record<AmlPatternType, string[]>> = {
  STRUCTURING: [
    'aggregateThresholdUsd',
    'maxIndividualAmountUsd',
    'minFlowCount',
  ],
  RAPID_MOVEMENT: ['movementRatio', 'minInflowUsd'],
  LAYERING: ['minDistinctDeals', 'minFlowCount'],
  VELOCITY: ['maxFlowsPerWindow'],
  HIGH_VALUE: ['amountThresholdUsd'],
  HIGH_RISK_JURISDICTION: ['countries'],
  BEHAVIORAL_ANOMALY: ['zScoreThreshold'],
};
