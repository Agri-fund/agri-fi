/**
 * Social & copy trading domain types (issue #1212).
 *
 * All monetary values are USD. All percentage fields are *percentage points*
 * (e.g. 12.5 means 12.5%) unless the name ends in `Ratio` or the type documents
 * a decimal fraction. Monthly return series are decimal fractions (0.015 = 1.5%).
 */

import type { Deal, Investment } from '@/lib/api';

export type SocialMetricWindow = '1m' | '3m' | '6m' | '12m' | 'all';

export type LeaderboardMetric =
  | 'roi'
  | 'sharpe'
  | 'sortino'
  | 'calmar'
  | 'winRate'
  | 'consistency';

export type RiskTier = 'low' | 'moderate' | 'elevated' | 'high';

export type RiskSeverity = 'info' | 'warning' | 'critical';

export interface PerformancePoint {
  /** Calendar period of the return, `YYYY-MM`. */
  period: string;
  /** Return for the period in percentage points. */
  returnPct: number;
  /** Compounded cumulative return since the series start, percentage points. */
  cumulativePct: number;
  /** Compounded growth of $100 through this period. */
  equityIndex: number;
}

export interface SectorExposure {
  sector: string;
  /** Value-weighted share of deployed capital, percentage points. */
  sharePct: number;
  deployedUsd: number;
}

export interface PerformanceMetrics {
  /** Compounded total return of the monthly series, percentage points. */
  cumulativeReturnPct: number;
  /** Realised ROI from settled investments: (returns - cost) / cost, percentage points. */
  realizedRoiPct: number;
  /** Share of settled investments with a positive realised return, percentage points. */
  winRatePct: number;
  avgHoldingDays: number;
  /** Peak-to-trough decline of the compounded series, percentage points (positive magnitude). */
  maxDrawdownPct: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  /** Annualised sample standard deviation of monthly returns, percentage points. */
  volatilityPct: number;
  /** 0-100 blend of positive-period rate, volatility and worst-period depth. */
  consistencyScore: number;
  bestPeriodPct: number;
  worstPeriodPct: number;
  positivePeriodRatePct: number;
  /** Share of the deal book that defaulted (`status === 'failed'`), percentage points. */
  defaultRatePct: number;
  tenureMonths: number;
  exposures: SectorExposure[];
  /** Top sector share, percentage points; 0 when there is no exposure. */
  topExposurePct: number;
  annualizedReturnPct: number;
  periodCount: number;
}

export interface TraderProfile {
  traderId: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  strategySummary: string;
  focusSectors: string[];
  regions: string[];
  joinedAt: string;
  verified: boolean;
  aumUsd: number;
  followerCount: number;
  performance: PerformancePoint[];
  /** Compact sparkline values (cumulative percentage points), oldest first. */
  sparkline: number[];
  /** Raw monthly returns (decimal fractions) the windowed boards are built from. */
  monthlyReturns: number[];
  /** Period of the first monthly return, `YYYY-MM`. */
  firstReturnPeriod: string;
  metrics: PerformanceMetrics;
  deals: Deal[];
  investments: Investment[];
}

export interface TraderIdentity {
  traderId: string;
  displayName: string;
  avatarUrl?: string | null;
  bio: string;
  strategySummary: string;
  focusSectors: string[];
  regions: string[];
  joinedAt: string;
  verified: boolean;
  aumUsd: number;
  followerCount: number;
  /** Monthly returns as decimal fractions, oldest first. */
  monthlyReturns: number[];
  /** Period of the first entry in `monthlyReturns`, `YYYY-MM`. */
  firstReturnPeriod: string;
}

export interface FollowRelationship {
  followerId: string;
  traderId: string;
  followedAt: string;
  source: 'profile' | 'leaderboard' | 'strategy' | 'suggestion';
}

export interface SuggestedTrader {
  traderId: string;
  displayName: string;
  score: number;
  reasons: string[];
}

export type CopyMode = 'proportional' | 'fixed' | 'inverse_risk';

export interface CopyConfig {
  id: string;
  followerId: string;
  traderId: string;
  mode: CopyMode;
  /** Proportional mode: share of the mirrored leader weight to take, percentage points. */
  allocationPct: number;
  /** Fixed mode: flat USD ticket per copied trade. */
  fixedAmountUsd: number;
  /** Inverse-risk mode: risk budget as a share of follower AUM, percentage points. */
  riskBudgetPct: number;
  /** Hard cap per copied trade, USD. */
  maxPerTrade: number;
  /** Hard cap of copied principal per calendar month, USD. */
  monthlyLimit: number;
  /** Trades sized below this are skipped, USD. */
  minTradeValue: number;
  /** Portfolio-level stop: unrealised loss (percentage points) that halts copying. */
  autoStopLossPct: number;
  /** Portfolio-level take: unrealised gain (percentage points) that halts copying. */
  autoTakeProfitPct: number;
  /** Peak-to-trough decline (percentage points) that halts copying. */
  maxDrawdownPct: number;
  /** Fee charged on each copied ticket, in basis points. */
  feeBps: number;
  /** Deal ids, commodities or regions that must never be copied. */
  blacklist: string[];
  notifications: boolean;
  enabled: boolean;
  /** Strategy id when the config was generated by `subscribeToStrategy`. */
  derivedFromStrategyId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpenPosition {
  dealId: string;
  traderId: string;
  openedAt: string;
  investedUsd: number;
  /** Marked-to-market value of the position. */
  currentUsd: number;
}

export interface AutoStopState {
  active: boolean;
  reason: string | null;
  at: string | null;
}

export interface PortfolioState {
  followerId: string;
  /** Free cash available for new copied trades, USD. */
  cashUsd: number;
  /** Total follower assets under management, USD (cash + open positions). */
  followerAumUsd: number;
  /** Leader AUM used as the proportional sizing denominator, USD. */
  leaderAumUsd: number;
  /** Copied principal already committed in the active month, USD. */
  monthSpendUsd: number;
  /** Active allowance month, `YYYY-MM`. */
  monthKey: string;
  positions: OpenPosition[];
  /** Deal ids the follower already copied — duplicate guard. */
  copiedDealIds: string[];
  equityUsd: number;
  peakEquityUsd: number;
  /** Peak-to-trough decline since tracking started, percentage points. */
  drawdownPct: number;
  /** Unrealised P&L against the starting equity, percentage points. */
  unrealizedPct: number;
  autoStop: AutoStopState;
  startingEquityUsd: number;
}

export interface CopyTradeEvent {
  traderId: string;
  dealId: string;
  /** Trade date, ISO `YYYY-MM-DD`. */
  date: string;
  amountUsd: number;
  commodity: string;
  region: string;
  riskRating: 'Low' | 'Medium' | 'High';
  expectedRoiPct: number;
  /** Realised outcome used by the dry-run simulator, percentage points. */
  realizedRoiPct?: number;
  title?: string;
}

export type CopyOrderStatus = 'planned' | 'submitted' | 'filled' | 'rejected';

export interface CopyOrder {
  id: string;
  configId: string;
  followerId: string;
  traderId: string;
  dealId: string;
  commodity: string;
  region: string;
  createdAt: string;
  leaderAmountUsd: number;
  /** Sized follower ticket before caps, USD. */
  sizedAmountUsd: number;
  /** Ticket actually submitted after caps, USD. */
  amountUsd: number;
  feeUsd: number;
  expectedRoiPct: number;
  status: CopyOrderStatus;
  sizingBasis: CopyMode;
}

export type CopyRejectionCode =
  | 'BELOW_MINIMUM'
  | 'EXCEEDS_PER_TRADE_LIMIT'
  | 'MONTHLY_LIMIT_REACHED'
  | 'BLACKLISTED'
  | 'AUTO_STOP_ACTIVE'
  | 'DUPLICATE'
  | 'INSUFFICIENT_BALANCE'
  | 'NOT_FOLLOWING'
  | 'COPY_DISABLED'
  | 'INVALID_INPUT';

export interface CopyRejection {
  code: CopyRejectionCode;
  message: string;
  details: Record<string, string | number>;
}

export type CopyDecision =
  | {
      accepted: true;
      reason: null;
      message: string;
      order: CopyOrder;
    }
  | {
      accepted: false;
      reason: CopyRejectionCode;
      message: string;
      rejection: CopyRejection;
      proposedAmountUsd: number;
    };

export interface LeaderboardEntry {
  rank: number;
  traderId: string;
  displayName: string;
  region: string | null;
  metric: LeaderboardMetric;
  /** Value of the ranked metric for the selected window. */
  metricValue: number;
  window: SocialMetricWindow;
  /** Human label for the selected window, e.g. `Last 3 month(s)`. */
  windowLabel: string;
  roiPct: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  maxDrawdownPct: number;
  winRatePct: number;
  consistencyScore: number;
  aumUsd: number;
  tenureMonths: number;
  followerCount: number;
  tierBadge: 'Platinum' | 'Gold' | 'Silver' | 'Bronze';
  riskScore: number | null;
  riskTier: RiskTier | null;
  verified: boolean;
  trendPct: number;
  /** Windowed cumulative returns, percentage points, oldest first. */
  sparkline: number[];
}

export interface LeaderboardOptions {
  metric?: LeaderboardMetric;
  window?: SocialMetricWindow;
  region?: string | null;
  minTenureMonths?: number;
  minAumUsd?: number;
  limit?: number;
  riskScores?: Record<string, { score: number; tier: RiskTier }>;
}

export interface RiskWarning {
  severity: RiskSeverity;
  code: string;
  message: string;
  mitigation: string;
}

export interface RiskFactor {
  key: string;
  label: string;
  /** Share of the composite score, decimal fraction; weights sum to 1. */
  weight: number;
  /** Observed input value feeding the subscore. */
  observed: number;
  /** 0-100 subscore for this factor. */
  subscore: number;
  /** weight * subscore, contributes to the composite score. */
  points: number;
}

export interface RiskAssessment {
  traderId: string;
  /** 0-100 composite risk (higher = riskier). */
  score: number;
  tier: RiskTier;
  warnings: RiskWarning[];
  factors: RiskFactor[];
  assessedAt: string;
}

export interface StrategyAllocation {
  sector: string;
  weightPct: number;
}

export interface StrategyVersion {
  version: number;
  changes: string;
  at: string;
}

export interface StrategyCopyTemplate {
  mode: CopyMode;
  allocationPct: number;
  fixedAmountUsd: number;
  riskBudgetPct: number;
  maxPerTrade: number;
  monthlyLimit: number;
  minTradeValue: number;
  autoStopLossPct: number;
  autoTakeProfitPct: number;
  maxDrawdownPct: number;
}

export interface SharedStrategy {
  id: string;
  authorId: string;
  authorName: string;
  title: string;
  summary: string;
  thesis: string;
  version: number;
  changelog: StrategyVersion[];
  status: 'draft' | 'published' | 'archived';
  targetRoiPct: number;
  maxRiskScore: number;
  horizonDays: number;
  allocations: StrategyAllocation[];
  regions: string[];
  excludedCommodities: string[];
  tags: string[];
  subscriberCount: number;
  copyTemplate: StrategyCopyTemplate;
  publishedAt: string;
  updatedAt: string;
}

export interface StrategyRevision {
  changes: string;
  title?: string;
  summary?: string;
  thesis?: string;
  targetRoiPct?: number;
  maxRiskScore?: number;
  horizonDays?: number;
  allocations?: StrategyAllocation[];
  regions?: string[];
  excludedCommodities?: string[];
  copyTemplate?: Partial<StrategyCopyTemplate>;
}

export interface FieldError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: FieldError[];
}

export type ThreadScopeType = 'deal' | 'strategy' | 'trader';

export interface DiscussionThread {
  id: string;
  scopeType: ThreadScopeType;
  scopeId: string;
  title: string;
  body: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  tags: string[];
  pinned: boolean;
  flagged: boolean;
  moderationReason: string | null;
  upvotes: number;
  upvotedBy: string[];
  commentCount: number;
}

export interface DiscussionComment {
  id: string;
  threadId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
  /** Null for top-level comments. */
  parentCommentId: string | null;
  depth: number;
  upvotes: number;
  upvotedBy: string[];
  flagged: boolean;
  moderationReason: string | null;
  edited: boolean;
}

export interface KeyInsight {
  threadId: string;
  comment: DiscussionComment;
}

export interface CopyResult {
  copyId: string;
  configId: string;
  followerId: string;
  traderId: string;
  dealId: string;
  commodity: string;
  region: string;
  amountUsd: number;
  feeUsd: number;
  openedAt: string;
  closedAt: string;
  monthKey: string;
  /** Follower realised return, percentage points. */
  followerReturnPct: number;
  /** Leader realised return on the same deal, percentage points. */
  leaderReturnPct: number;
  leaderEntryPrice: number;
  followerEntryPrice: number;
  pnlUsd: number;
}

export interface CopyMonthBucket {
  monthKey: string;
  copies: number;
  successRatePct: number;
  avgReturnPct: number;
  pnlUsd: number;
}

export interface PnlAttribution {
  key: string;
  label: string;
  copies: number;
  deployedUsd: number;
  pnlUsd: number;
  /** Share of the absolute realised P&L, percentage points. */
  contributionPct: number;
  avgReturnPct: number;
}

export interface CopyPerformanceStats {
  followerId: string;
  totalCopies: number;
  successfulCopies: number;
  successRatePct: number;
  /** Share of copies that matched or beat the leader's return. */
  beatLeaderRatePct: number;
  avgReturnPct: number;
  medianReturnPct: number;
  avgWinPct: number;
  avgLossPct: number;
  /** Mean (follower entry - leader entry) / leader entry, percentage points. */
  avgSlippagePct: number;
  worstSlippagePct: number;
  /** Pearson correlation between follower and leader returns, -1..1. */
  fidelity: number;
  /** Sample standard deviation of (follower - leader) returns, percentage points. */
  trackingErrorPct: number;
  totalPnlUsd: number;
  grossProfitUsd: number;
  grossLossUsd: number;
  /** grossProfit / grossLoss, or null when there were no losses. */
  profitFactor: number | null;
  totalFeesUsd: number;
  avgHoldingDays: number;
  monthly: CopyMonthBucket[];
  attribution: PnlAttribution[];
  bestCopy: CopyResult | null;
  worstCopy: CopyResult | null;
}

export interface CopyVsOrganicComparison {
  copies: CopyPerformanceStats;
  organic: CopyPerformanceStats;
  successRateDeltaPct: number;
  avgReturnDeltaPct: number;
  pnlDeltaUsd: number;
  verdict: 'copying_ahead' | 'copying_behind' | 'even';
  summary: string;
}

export interface SimulationResult {
  configId: string;
  decisions: { trade: CopyTradeEvent; decision: CopyDecision }[];
  orders: CopyOrder[];
  rejections: CopyRejection[];
  equityCurve: { date: string; equityUsd: number; drawdownPct: number }[];
  finalPortfolio: PortfolioState;
  deployedUsd: number;
  feesUsd: number;
  simulatedReturnPct: number;
}
