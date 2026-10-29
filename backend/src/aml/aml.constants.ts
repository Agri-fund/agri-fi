/**
 * Shared vocabulary for automated AML/KYC transaction monitoring (#1217).
 *
 * The strings here are what lands in the database, so they are deliberately
 * plain varchar unions (the same style `compliance/entities/regulatory-rule.entity.ts`
 * uses) instead of Postgres enums: adding a new pattern or disposition must not
 * require a migration.
 */

/** Behavioural or static pattern a monitoring rule detects. */
export type AmlPatternType =
  | 'STRUCTURING'
  | 'RAPID_MOVEMENT'
  | 'LAYERING'
  | 'VELOCITY'
  | 'HIGH_VALUE'
  | 'HIGH_RISK_JURISDICTION'
  | 'SANCTIONS_MATCH'
  | 'PEP_MATCH'
  | 'BEHAVIORAL_ANOMALY';

export const AML_PATTERN_TYPES: AmlPatternType[] = [
  'STRUCTURING',
  'RAPID_MOVEMENT',
  'LAYERING',
  'VELOCITY',
  'HIGH_VALUE',
  'HIGH_RISK_JURISDICTION',
  'SANCTIONS_MATCH',
  'PEP_MATCH',
  'BEHAVIORAL_ANOMALY',
];

/** Mirrors `RuleSeverity` in the regulatory rule engine. */
export type AmlSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Mirrors `RuleAction` in the regulatory rule engine. */
export type AmlRuleAction =
  | 'ALLOW'
  | 'FLAG_REVIEW'
  | 'REQUIRE_ENHANCED_DUE_DILIGENCE'
  | 'REJECT'
  | 'CAP_TRANSACTION';

export type AmlAlertStatus =
  'pending' | 'triaged' | 'escalated' | 'false_positive' | 'dismissed';

export type AmlCaseStatus =
  'open' | 'in_review' | 'escalated' | 'awaiting_information' | 'closed';

/** How an analyst finally disposed of an alert or case. */
export type AmlDisposition =
  | 'false_positive'
  | 'sar_filed'
  | 'no_action'
  | 'referred_to_authority'
  | 'account_restricted';

export type SanctionsListSource = 'OFAC' | 'UN' | 'EU';

export type SanctionsEntryType = 'PERSON' | 'ENTITY' | 'VESSEL' | 'AIRCRAFT';

export type AmlScreeningDecision = 'clear' | 'review' | 'match';

export type AmlScreeningSubjectType = 'user' | 'wallet' | 'transaction';

export type SarStatus = 'draft' | 'reviewed' | 'submitted' | 'acknowledged';

export type RegulatorySubmissionStatus =
  'pending' | 'accepted' | 'rejected' | 'failed';

export type AmlRunStatus = 'running' | 'completed' | 'failed' | 'skipped';

/** Money movement directions used by the cash-flow projection. */
export type CashFlowDirection = 'in' | 'out';

export interface CashFlow {
  id: string;
  userId: string;
  direction: CashFlowDirection;
  amountUsd: number;
  at: Date;
  /** Deal id the flow relates to, when known. */
  dealId: string | null;
  /** Table the row came from, so evidence stays traceable to source data. */
  source: 'investments' | 'payment_distributions' | 'transaction_logs';
  counterpartyCountry?: string | null;
  commodity?: string | null;
}

export interface PatternMatch {
  patternType: AmlPatternType;
  ruleId: string;
  ruleCode: string;
  severity: AmlSeverity;
  action: AmlRuleAction;
  /** 0-100 before false-positive tuning. */
  baseRiskScore: number;
  /** 0-100 after the rule's sensitivity multiplier. */
  riskScore: number;
  title: string;
  reason: string;
  /** Idempotency key; an alert is only raised once per key. */
  dedupeKey: string;
  evidence: Record<string, unknown>;
  amountUsd?: number;
  flowIds?: string[];
}

/**
 * Sensitivity multiplier applied to a rule's base risk score, derived from how
 * often analysts have dismissed its alerts as false positives. Below 1 the rule
 * quiets down; above 1 it stays at full strength even when rarely confirmed.
 */
export function sensitivityFromDisposition(
  falsePositives: number,
  truePositives: number,
): number {
  const total = falsePositives + truePositives;
  if (total < 5) return 1;
  const fpRate = falsePositives / total;
  if (fpRate >= 0.9) return 0.4;
  if (fpRate >= 0.75) return 0.6;
  if (fpRate >= 0.5) return 0.8;
  if (fpRate >= 0.25) return 1;
  return 1.25;
}
