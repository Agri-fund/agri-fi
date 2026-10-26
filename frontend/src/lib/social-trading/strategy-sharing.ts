/**
 * Strategy sharing (issue #1212): authoring, versioning, validation and the
 * strategy -> `CopyConfig` mapping that feeds the copy-trading engine.
 */

import { z } from 'zod';
import { round2 } from './copy-trading';
import type {
  CopyConfig,
  FieldError,
  SharedStrategy,
  StrategyAllocation,
  StrategyCopyTemplate,
  StrategyRevision,
  ValidationResult,
} from './types';

export const STRATEGY_ALLOCATIONS_TOTAL_PCT = 100;

export interface StrategyDraft {
  authorId: string;
  authorName: string;
  title: string;
  summary: string;
  thesis: string;
  targetRoiPct: number;
  maxRiskScore: number;
  horizonDays: number;
  allocations: StrategyAllocation[];
  regions: string[];
  excludedCommodities: string[];
  tags: string[];
  copyTemplate: StrategyCopyTemplate;
  status?: SharedStrategy['status'];
}

const allocationSchema = z.object({
  sector: z.string().min(2),
  weightPct: z.number().min(1).max(100),
});

const copyTemplateSchema = z.object({
  mode: z.enum(['proportional', 'fixed', 'inverse_risk']),
  allocationPct: z.number().min(1).max(100),
  fixedAmountUsd: z.number().min(0),
  riskBudgetPct: z.number().min(0).max(100),
  maxPerTrade: z.number().positive(),
  monthlyLimit: z.number().positive(),
  minTradeValue: z.number().min(0),
  autoStopLossPct: z.number().min(0).max(100),
  autoTakeProfitPct: z.number().min(0).max(500),
  maxDrawdownPct: z.number().min(1).max(100),
});

export const strategySchema = z.object({
  authorId: z.string().min(1),
  authorName: z.string().min(2),
  title: z.string().min(8).max(120),
  summary: z.string().min(20).max(320),
  thesis: z.string().min(40).max(4000),
  targetRoiPct: z.number().min(0).max(100),
  maxRiskScore: z.number().min(0).max(100),
  horizonDays: z.number().int().min(30).max(1095),
  allocations: z.array(allocationSchema).min(1).max(8),
  regions: z.array(z.string().min(2)).min(1).max(6),
  excludedCommodities: z.array(z.string().min(2)).max(12),
  tags: z.array(z.string().min(2)).max(8),
  copyTemplate: copyTemplateSchema,
});

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function allocationTotal(allocations: StrategyAllocation[]): number {
  return round2(allocations.reduce((sum, a) => sum + a.weightPct, 0));
}

/**
 * Structural (zod) validation plus the business rules zod cannot express: weights
 * must total 100% and the copy template must stay inside the strategy's own risk bound.
 */
export function validateStrategy(input: unknown): ValidationResult {
  const parsed = strategySchema.safeParse(input);
  const errors: FieldError[] = [];

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({ path: issue.path.join('.') || 'strategy', message: issue.message });
    }
    return { valid: false, errors };
  }

  const value = parsed.data as StrategyDraft;
  const total = allocationTotal(value.allocations);
  if (total !== STRATEGY_ALLOCATIONS_TOTAL_PCT) {
    errors.push({
      path: 'allocations',
      message: `Sector weights total ${total}%; they must total ${STRATEGY_ALLOCATIONS_TOTAL_PCT}%.`,
    });
  }

  const sectors = new Set(value.allocations.map((a) => a.sector.toLowerCase()));
  if (sectors.size !== value.allocations.length) {
    errors.push({ path: 'allocations', message: 'Each sector may appear only once.' });
  }

  if (value.copyTemplate.monthlyLimit < value.copyTemplate.maxPerTrade) {
    errors.push({
      path: 'copyTemplate.monthlyLimit',
      message: 'Monthly limit must be at least the per-trade cap.',
    });
  }
  if (value.copyTemplate.minTradeValue > value.copyTemplate.maxPerTrade) {
    errors.push({
      path: 'copyTemplate.minTradeValue',
      message: 'Minimum trade size cannot exceed the per-trade cap.',
    });
  }
  if (value.copyTemplate.maxDrawdownPct > value.maxRiskScore) {
    errors.push({
      path: 'copyTemplate.maxDrawdownPct',
      message: `Drawdown stop ${value.copyTemplate.maxDrawdownPct}% exceeds the strategy risk bound of ${value.maxRiskScore}%.`,
    });
  }
  if (value.targetRoiPct > 25 && value.maxRiskScore < 40) {
    errors.push({
      path: 'targetRoiPct',
      message: 'A target above 25% ROI needs a risk bound of at least 40.',
    });
  }

  return { valid: errors.length === 0, errors };
}

export function publishStrategy(
  draft: StrategyDraft,
  options: { at?: string; id?: string } = {},
): SharedStrategy {
  const at = options.at ?? new Date().toISOString();
  const status = draft.status ?? 'published';
  return {
    id: options.id ?? `strategy:${slugify(draft.title)}-v1`,
    authorId: draft.authorId,
    authorName: draft.authorName,
    title: draft.title,
    summary: draft.summary,
    thesis: draft.thesis,
    version: 1,
    changelog: [{ version: 1, changes: 'Initial publication.', at }],
    status,
    targetRoiPct: draft.targetRoiPct,
    maxRiskScore: draft.maxRiskScore,
    horizonDays: draft.horizonDays,
    allocations: draft.allocations.map((a) => ({ ...a })),
    regions: [...draft.regions],
    excludedCommodities: [...draft.excludedCommodities],
    tags: [...draft.tags],
    subscriberCount: 0,
    copyTemplate: { ...draft.copyTemplate },
    publishedAt: at,
    updatedAt: at,
  };
}

/** Bumps the version, records the changelog entry and keeps the id stable. */
export function reviseStrategy(
  strategy: SharedStrategy,
  revision: StrategyRevision,
  options: { at?: string } = {},
): SharedStrategy {
  const at = options.at ?? new Date().toISOString();
  const version = strategy.version + 1;
  return {
    ...strategy,
    title: revision.title ?? strategy.title,
    summary: revision.summary ?? strategy.summary,
    thesis: revision.thesis ?? strategy.thesis,
    targetRoiPct: revision.targetRoiPct ?? strategy.targetRoiPct,
    maxRiskScore: revision.maxRiskScore ?? strategy.maxRiskScore,
    horizonDays: revision.horizonDays ?? strategy.horizonDays,
    allocations: revision.allocations
      ? revision.allocations.map((a) => ({ ...a }))
      : strategy.allocations,
    regions: revision.regions ? [...revision.regions] : strategy.regions,
    excludedCommodities: revision.excludedCommodities
      ? [...revision.excludedCommodities]
      : strategy.excludedCommodities,
    copyTemplate: { ...strategy.copyTemplate, ...revision.copyTemplate },
    version,
    changelog: [
      ...strategy.changelog,
      { version, changes: revision.changes, at },
    ],
    updatedAt: at,
  };
}

export function archiveStrategy(
  strategy: SharedStrategy,
  options: { at?: string } = {},
): SharedStrategy {
  return {
    ...strategy,
    status: 'archived',
    updatedAt: options.at ?? new Date().toISOString(),
  };
}

/**
 * Turns a published strategy into a ready-to-save copy configuration.
 * The config is returned disabled: subscribing to a strategy is a declaration of
 * intent, and the follower must still accept the risk warnings before it trades.
 */
export function subscribeToStrategy(
  strategy: SharedStrategy,
  followerId: string,
  options: { at?: string; traderId?: string } = {},
): CopyConfig {
  const at = options.at ?? new Date().toISOString();
  const template = strategy.copyTemplate;
  return {
    id: `copycfg:${followerId}:${strategy.authorId}`,
    followerId,
    traderId: options.traderId ?? strategy.authorId,
    mode: template.mode,
    allocationPct: template.allocationPct,
    fixedAmountUsd: template.fixedAmountUsd,
    riskBudgetPct: template.riskBudgetPct,
    maxPerTrade: template.maxPerTrade,
    monthlyLimit: template.monthlyLimit,
    minTradeValue: template.minTradeValue,
    autoStopLossPct: template.autoStopLossPct,
    autoTakeProfitPct: template.autoTakeProfitPct,
    // A strategy never loosens its own risk bound: the tighter of the two wins.
    maxDrawdownPct: Math.min(template.maxDrawdownPct, strategy.maxRiskScore),
    feeBps: 30,
    blacklist: [...strategy.excludedCommodities],
    notifications: true,
    enabled: false,
    derivedFromStrategyId: strategy.id,
    createdAt: at,
    updatedAt: at,
  };
}

export function unsubscribeFromStrategy(
  config: CopyConfig | undefined,
  options: { at?: string } = {},
): CopyConfig | undefined {
  if (!config) return config;
  return { ...config, enabled: false, updatedAt: options.at ?? new Date().toISOString() };
}

export function recordStrategySubscriber(
  strategy: SharedStrategy,
  delta = 1,
): SharedStrategy {
  return { ...strategy, subscriberCount: Math.max(0, strategy.subscriberCount + delta) };
}

export type StrategyFeedSort = 'hot' | 'recent' | 'followers' | 'roi';

/** Reddit-style hot weighting: log-scaled demand minus publication age in days. */
export function strategyHotScore(strategy: SharedStrategy, nowMs: number): number {
  const demand = Math.log10(Math.max(strategy.subscriberCount, 1) + 1) * 20;
  const freshness = Math.max(
    0,
    30 - (nowMs - new Date(strategy.publishedAt).getTime()) / 86_400_000,
  );
  return Math.round((demand + freshness) * 100) / 100;
}

export function sortStrategyFeed(
  strategies: SharedStrategy[],
  options: { by?: StrategyFeedSort; now?: string; limit?: number } = {},
): SharedStrategy[] {
  const by = options.by ?? 'hot';
  const nowMs = new Date(options.now ?? new Date().toISOString()).getTime();
  const published = strategies.filter((s) => s.status === 'published');

  const sorted = [...published].sort((a, b) => {
    switch (by) {
      case 'followers':
        return (
          b.subscriberCount - a.subscriberCount ||
          b.publishedAt.localeCompare(a.publishedAt) ||
          a.id.localeCompare(b.id)
        );
      case 'recent':
        return (
          b.updatedAt.localeCompare(a.updatedAt) ||
          b.subscriberCount - a.subscriberCount ||
          a.id.localeCompare(b.id)
        );
      case 'roi':
        return (
          b.targetRoiPct - a.targetRoiPct ||
          b.subscriberCount - a.subscriberCount ||
          a.id.localeCompare(b.id)
        );
      case 'hot':
      default:
        return (
          strategyHotScore(b, nowMs) - strategyHotScore(a, nowMs) ||
          b.subscriberCount - a.subscriberCount ||
          a.id.localeCompare(b.id)
        );
    }
  });

  return options.limit ? sorted.slice(0, options.limit) : sorted;
}

export function strategiesByAuthor(
  strategies: SharedStrategy[],
  authorId: string,
): SharedStrategy[] {
  return strategies
    .filter((s) => s.authorId === authorId)
    .sort((a, b) => b.version - a.version || a.id.localeCompare(b.id));
}
