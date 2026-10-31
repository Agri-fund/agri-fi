import { describe, expect, it } from 'vitest';

import {
  STRATEGY_ALLOCATIONS_TOTAL_PCT,
  archiveStrategy,
  publishStrategy,
  recordStrategySubscriber,
  reviseStrategy,
  slugify,
  sortStrategyFeed,
  strategiesByAuthor,
  strategyHotScore,
  subscribeToStrategy,
  unsubscribeFromStrategy,
  validateStrategy,
  type StrategyDraft,
} from '../strategy-sharing';
import type { SharedStrategy } from '../types';

function baseDraft(overrides: Partial<StrategyDraft> = {}): StrategyDraft {
  return {
    authorId: 'trader-a',
    authorName: 'Amina Osei',
    title: 'Coastal Coffee Diversification',
    summary: 'Blends early and late harvest coffee exposure across two coastal regions.',
    thesis:
      'Coffee prices mean-revert after weather shocks, so blending harvest windows smooths returns.',
    targetRoiPct: 12,
    maxRiskScore: 30,
    horizonDays: 180,
    allocations: [
      { sector: 'Coffee', weightPct: 45 },
      { sector: 'Cashews', weightPct: 30 },
      { sector: 'Logistics', weightPct: 25 },
    ],
    regions: ['Kenya', 'Uganda'],
    excludedCommodities: ['Tobacco'],
    tags: ['coffee', 'diversified'],
    copyTemplate: {
      mode: 'proportional',
      allocationPct: 60,
      fixedAmountUsd: 0,
      riskBudgetPct: 5,
      maxPerTrade: 800,
      monthlyLimit: 2400,
      minTradeValue: 50,
      autoStopLossPct: 15,
      autoTakeProfitPct: 40,
      maxDrawdownPct: 20,
    },
    ...overrides,
  };
}

function publish(overrides: Partial<StrategyDraft> = {}, at = '2026-03-01T00:00:00.000Z') {
  return publishStrategy(baseDraft(overrides), { at });
}

function strategyRow(
  id: string,
  overrides: Partial<SharedStrategy> = {},
): SharedStrategy {
  return {
    ...publish(),
    id,
    authorId: 'trader-a',
    version: 1,
    status: 'published',
    subscriberCount: 0,
    targetRoiPct: 12,
    maxRiskScore: 30,
    publishedAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

describe('slugify', () => {
  it('lowercases and collapses runs of non-alphanumerics into single dashes', () => {
    expect(slugify('Coastal Coffee Diversification')).toBe('coastal-coffee-diversification');
    expect(slugify('Coffee, Cocoa!! & Cashews')).toBe('coffee-cocoa-cashews');
    expect(slugify('  Hello, World!  ')).toBe('hello-world');
  });

  it('strips leading and trailing separators', () => {
    expect(slugify('***Coffee***')).toBe('coffee');
  });

  it('maps pure punctuation to an empty slug', () => {
    expect(slugify('!!! ???')).toBe('');
  });

  it('truncates to 60 characters', () => {
    expect(slugify('a'.repeat(70))).toBe('a'.repeat(60));
    expect(slugify('a'.repeat(70))).toHaveLength(60);
  });
});

describe('validateStrategy', () => {
  it('accepts a fully valid draft', () => {
    expect(validateStrategy(baseDraft())).toEqual({ valid: true, errors: [] });
  });

  it('reports business-rule errors as structured field errors', () => {
    const result = validateStrategy(
      baseDraft({
        allocations: [
          { sector: 'Coffee', weightPct: 50 },
          { sector: 'Cashews', weightPct: 30 },
          { sector: 'Logistics', weightPct: 10 },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      { path: 'allocations', message: 'Sector weights total 90%; they must total 100%.' },
    ]);
  });

  it('rejects duplicated sectors case-insensitively', () => {
    const result = validateStrategy(
      baseDraft({
        allocations: [
          { sector: 'Coffee', weightPct: 60 },
          { sector: 'coffee', weightPct: 40 },
        ],
      }),
    );
    expect(result.errors).toEqual([
      { path: 'allocations', message: 'Each sector may appear only once.' },
    ]);
  });

  it('reports every missing required field in schema order', () => {
    const result = validateStrategy({});
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      [
        'authorId',
        'authorName',
        'title',
        'summary',
        'thesis',
        'targetRoiPct',
        'maxRiskScore',
        'horizonDays',
        'allocations',
        'regions',
        'excludedCommodities',
        'tags',
        'copyTemplate',
      ].map((path) => ({ path, message: 'Required' })),
    );
  });

  it('reports out-of-range values with dotted array paths', () => {
    const draft = baseDraft({
      title: 'Short',
      targetRoiPct: 120,
      horizonDays: 10,
      allocations: [{ sector: 'Coffee', weightPct: 100 }, { sector: 'X', weightPct: 0 }],
    });
    const result = validateStrategy(draft);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      { path: 'title', message: 'String must contain at least 8 character(s)' },
      { path: 'targetRoiPct', message: 'Number must be less than or equal to 100' },
      { path: 'horizonDays', message: 'Number must be greater than or equal to 30' },
      { path: 'allocations.1.sector', message: 'String must contain at least 2 character(s)' },
      { path: 'allocations.1.weightPct', message: 'Number must be greater than or equal to 1' },
    ]);
  });

  it('requires the monthly limit to cover the per-trade cap', () => {
    const draft = baseDraft();
    draft.copyTemplate.monthlyLimit = 500;
    expect(validateStrategy(draft).errors).toEqual([
      {
        path: 'copyTemplate.monthlyLimit',
        message: 'Monthly limit must be at least the per-trade cap.',
      },
    ]);
  });

  it('rejects a minimum trade size above the per-trade cap', () => {
    const draft = baseDraft();
    draft.copyTemplate.minTradeValue = 900;
    expect(validateStrategy(draft).errors).toEqual([
      {
        path: 'copyTemplate.minTradeValue',
        message: 'Minimum trade size cannot exceed the per-trade cap.',
      },
    ]);
  });

  it('rejects a drawdown stop above the strategy risk bound', () => {
    const draft = baseDraft({ maxRiskScore: 30 });
    draft.copyTemplate.maxDrawdownPct = 45;
    expect(validateStrategy(draft).errors).toEqual([
      {
        path: 'copyTemplate.maxDrawdownPct',
        message: 'Drawdown stop 45% exceeds the strategy risk bound of 30%.',
      },
    ]);
  });

  it('requires a risk bound of 40 for targets above 25% ROI', () => {
    const result = validateStrategy(baseDraft({ targetRoiPct: 30, maxRiskScore: 20 }));
    expect(result.errors).toEqual([
      {
        path: 'targetRoiPct',
        message: 'A target above 25% ROI needs a risk bound of at least 40.',
      },
    ]);
  });

  it('collects several business-rule failures at once', () => {
    const draft = baseDraft({
      targetRoiPct: 30,
      maxRiskScore: 20,
      allocations: [
        { sector: 'Coffee', weightPct: 50 },
        { sector: 'Cashews', weightPct: 30 },
        { sector: 'Logistics', weightPct: 10 },
      ],
    });
    draft.copyTemplate.maxDrawdownPct = 35;
    const result = validateStrategy(draft);
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.path)).toEqual([
      'allocations',
      'copyTemplate.maxDrawdownPct',
      'targetRoiPct',
    ]);
  });
});

describe('publishStrategy', () => {
  it('produces the v1 shape with a slug-based id and initial changelog', () => {
    const at = '2026-03-01T00:00:00.000Z';
    const strategy = publishStrategy(baseDraft(), { at });
    expect(strategy).toEqual({
      id: 'strategy:coastal-coffee-diversification-v1',
      authorId: 'trader-a',
      authorName: 'Amina Osei',
      title: 'Coastal Coffee Diversification',
      summary: 'Blends early and late harvest coffee exposure across two coastal regions.',
      thesis:
        'Coffee prices mean-revert after weather shocks, so blending harvest windows smooths returns.',
      version: 1,
      changelog: [{ version: 1, changes: 'Initial publication.', at }],
      status: 'published',
      targetRoiPct: 12,
      maxRiskScore: 30,
      horizonDays: 180,
      allocations: [
        { sector: 'Coffee', weightPct: 45 },
        { sector: 'Cashews', weightPct: 30 },
        { sector: 'Logistics', weightPct: 25 },
      ],
      regions: ['Kenya', 'Uganda'],
      excludedCommodities: ['Tobacco'],
      tags: ['coffee', 'diversified'],
      subscriberCount: 0,
      copyTemplate: {
        mode: 'proportional',
        allocationPct: 60,
        fixedAmountUsd: 0,
        riskBudgetPct: 5,
        maxPerTrade: 800,
        monthlyLimit: 2400,
        minTradeValue: 50,
        autoStopLossPct: 15,
        autoTakeProfitPct: 40,
        maxDrawdownPct: 20,
      },
      publishedAt: at,
      updatedAt: at,
    });
  });

  it('honours an explicit id and a draft status override', () => {
    const strategy = publishStrategy(baseDraft({ status: 'draft' }), {
      at: '2026-03-01T00:00:00.000Z',
      id: 'custom-id',
    });
    expect(strategy.id).toBe('custom-id');
    expect(strategy.status).toBe('draft');
  });

  it('copies the draft allocations instead of sharing references', () => {
    const draft = baseDraft();
    const strategy = publishStrategy(draft, { at: '2026-03-01T00:00:00.000Z' });
    expect(strategy.allocations[0]).not.toBe(draft.allocations[0]);
    expect(strategy.allocations).toEqual(draft.allocations);
  });

  it('keeps STRATEGY_ALLOCATIONS_TOTAL_PCT at 100', () => {
    expect(STRATEGY_ALLOCATIONS_TOTAL_PCT).toBe(100);
  });
});

describe('reviseStrategy', () => {
  it('bumps the version, applies the revision and appends the changelog', () => {
    const v1 = publishStrategy(baseDraft(), { at: '2026-03-01T00:00:00.000Z' });
    const v2 = reviseStrategy(
      v1,
      {
        changes: 'Raised the coffee weight.',
        targetRoiPct: 15,
        allocations: [{ sector: 'Coffee', weightPct: 100 }],
      },
      { at: '2026-04-01T00:00:00.000Z' },
    );

    expect(v2.version).toBe(2);
    expect(v2.id).toBe(v1.id);
    expect(v2.publishedAt).toBe('2026-03-01T00:00:00.000Z');
    expect(v2.updatedAt).toBe('2026-04-01T00:00:00.000Z');
    expect(v2.targetRoiPct).toBe(15);
    expect(v2.summary).toBe(v1.summary);
    expect(v2.allocations).toEqual([{ sector: 'Coffee', weightPct: 100 }]);
    expect(v2.changelog).toEqual([
      { version: 1, changes: 'Initial publication.', at: '2026-03-01T00:00:00.000Z' },
      { version: 2, changes: 'Raised the coffee weight.', at: '2026-04-01T00:00:00.000Z' },
    ]);
  });

  it('keeps all previous versions in the changelog across revisions', () => {
    const v1 = publishStrategy(baseDraft(), { at: '2026-03-01T00:00:00.000Z' });
    const v2 = reviseStrategy(v1, { changes: 'Second.' }, { at: '2026-04-01T00:00:00.000Z' });
    const v3 = reviseStrategy(v2, { changes: 'Third.' }, { at: '2026-05-01T00:00:00.000Z' });

    expect(v3.version).toBe(3);
    expect(v3.changelog).toHaveLength(3);
    expect(v3.changelog.map((entry) => entry.version)).toEqual([1, 2, 3]);
    expect(v3.changelog.map((entry) => entry.changes)).toEqual([
      'Initial publication.',
      'Second.',
      'Third.',
    ]);
  });

  it('merges only the copy-template fields present in the revision', () => {
    const v1 = publishStrategy(baseDraft(), { at: '2026-03-01T00:00:00.000Z' });
    const v2 = reviseStrategy(
      v1,
      { changes: 'Bigger tickets.', copyTemplate: { maxPerTrade: 1200, mode: 'fixed' } },
      { at: '2026-04-01T00:00:00.000Z' },
    );
    expect(v2.copyTemplate).toEqual({ ...v1.copyTemplate, maxPerTrade: 1200, mode: 'fixed' });
    expect(v2.copyTemplate).not.toBe(v1.copyTemplate);
  });

  it('does not mutate a frozen input strategy', () => {
    const v1 = deepFreeze(publishStrategy(baseDraft(), { at: '2026-03-01T00:00:00.000Z' }));
    const snapshot = JSON.parse(JSON.stringify(v1));
    const v2 = reviseStrategy(
      v1,
      { changes: 'New thesis.', thesis: 'An entirely new thesis body that is sufficiently long.', regions: ['Tanzania'] },
      { at: '2026-04-01T00:00:00.000Z' },
    );
    expect(v1).toEqual(snapshot);
    expect(v2).not.toBe(v1);
    expect(v2.version).toBe(2);
    expect(v2.regions).toEqual(['Tanzania']);
  });
});

describe('archiveStrategy', () => {
  it('flips the status and stamps updatedAt without touching the changelog', () => {
    const v1 = publishStrategy(baseDraft(), { at: '2026-03-01T00:00:00.000Z' });
    const archived = archiveStrategy(v1, { at: '2026-06-01T00:00:00.000Z' });
    expect(archived.status).toBe('archived');
    expect(archived.updatedAt).toBe('2026-06-01T00:00:00.000Z');
    expect(archived.publishedAt).toBe('2026-03-01T00:00:00.000Z');
    expect(archived.version).toBe(1);
    expect(archived.changelog).toHaveLength(1);
    expect(v1.status).toBe('published');
  });
});

describe('subscribeToStrategy', () => {
  it('maps the copy template into a disabled copy config', () => {
    const strategy = publishStrategy(baseDraft(), { at: '2026-03-01T00:00:00.000Z' });
    const config = subscribeToStrategy(strategy, 'follower-1', {
      at: '2026-03-02T00:00:00.000Z',
    });
    expect(config).toEqual({
      id: 'copycfg:follower-1:trader-a',
      followerId: 'follower-1',
      traderId: 'trader-a',
      mode: 'proportional',
      allocationPct: 60,
      fixedAmountUsd: 0,
      riskBudgetPct: 5,
      maxPerTrade: 800,
      monthlyLimit: 2400,
      minTradeValue: 50,
      autoStopLossPct: 15,
      autoTakeProfitPct: 40,
      maxDrawdownPct: 20,
      feeBps: 30,
      blacklist: ['Tobacco'],
      notifications: true,
      enabled: false,
      derivedFromStrategyId: 'strategy:coastal-coffee-diversification-v1',
      createdAt: '2026-03-02T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
    });
  });

  it('caps the drawdown stop at the strategy risk bound', () => {
    const draft = baseDraft();
    draft.copyTemplate.maxDrawdownPct = 28;
    const strategy = publishStrategy(draft, { at: '2026-03-01T00:00:00.000Z' });
    const config = subscribeToStrategy({ ...strategy, maxRiskScore: 12 }, 'f1', {
      at: '2026-03-02T00:00:00.000Z',
      traderId: 'trader-x',
    });
    expect(config.maxDrawdownPct).toBe(12);
    expect(config.traderId).toBe('trader-x');
  });
});

describe('unsubscribeFromStrategy', () => {
  it('leaves an undefined config untouched', () => {
    expect(unsubscribeFromStrategy(undefined)).toBeUndefined();
  });

  it('disables the config and re-stamps updatedAt without mutating the input', () => {
    const strategy = publishStrategy(baseDraft(), { at: '2026-03-01T00:00:00.000Z' });
    const config = { ...subscribeToStrategy(strategy, 'f1', { at: '2026-03-02T00:00:00.000Z' }) };
    const frozen = Object.freeze({ ...config });
    const off = unsubscribeFromStrategy(frozen, { at: '2026-03-03T00:00:00.000Z' });
    expect(off).not.toBe(frozen);
    expect(off?.enabled).toBe(false);
    expect(off?.updatedAt).toBe('2026-03-03T00:00:00.000Z');
    expect(off?.allocationPct).toBe(60);
    expect(off?.maxPerTrade).toBe(800);
    expect(config.updatedAt).toBe('2026-03-02T00:00:00.000Z');
  });
});

describe('recordStrategySubscriber', () => {
  it('increments by one by default and honours custom deltas', () => {
    const strategy = strategyRow('s1', { subscriberCount: 3 });
    expect(recordStrategySubscriber(strategy).subscriberCount).toBe(4);
    expect(recordStrategySubscriber(strategy, 5).subscriberCount).toBe(8);
    expect(recordStrategySubscriber(strategy, -2).subscriberCount).toBe(1);
    expect(strategy.subscriberCount).toBe(3);
  });

  it('clamps the count at zero', () => {
    const strategy = strategyRow('s1', { subscriberCount: 2 });
    expect(recordStrategySubscriber(strategy, -10).subscriberCount).toBe(0);
  });
});

describe('strategyHotScore', () => {
  const now = Date.parse('2026-03-15T00:00:00.000Z');

  it('scores log-scaled demand plus freshness', () => {
    const old = strategyRow('s-a', { subscriberCount: 99, publishedAt: '2026-01-01T00:00:00.000Z' });
    const mid = strategyRow('s-b', { subscriberCount: 9, publishedAt: '2026-03-01T00:00:00.000Z' });
    const fresh = strategyRow('s-c', { subscriberCount: 0, publishedAt: '2026-03-15T00:00:00.000Z' });
    // s-a: log10(100)*20 = 40, published 73 days ago so freshness is floored at 0.
    expect(strategyHotScore(old, now)).toBe(40);
    // s-b: log10(10)*20 = 20, published 14 days ago so freshness = 30 - 14 = 16.
    expect(strategyHotScore(mid, now)).toBe(36);
    // s-c: log10(2)*20 = 6.020599913..., published now so freshness = 30.
    expect(strategyHotScore(fresh, now)).toBeCloseTo(36.02, 10);
  });

  it('treats zero subscribers like one for the log term', () => {
    const strategy = strategyRow('s-zero', {
      subscriberCount: 0,
      publishedAt: '2026-03-15T00:00:00.000Z',
    });
    // demand = log10(max(0,1) + 1) * 20 = 6.0206..., freshness = 30 exactly.
    expect(strategyHotScore(strategy, now)).toBe(36.02);
  });
});

describe('sortStrategyFeed', () => {
  const strategies: SharedStrategy[] = [
    strategyRow('s-followers', {
      subscriberCount: 500,
      publishedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      targetRoiPct: 5,
    }),
    strategyRow('s-recent', {
      subscriberCount: 1,
      publishedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-03-14T00:00:00.000Z',
      targetRoiPct: 5,
    }),
    strategyRow('s-hot', {
      subscriberCount: 9,
      publishedAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      targetRoiPct: 12,
    }),
    strategyRow('s-roi-1', {
      subscriberCount: 100,
      publishedAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
      targetRoiPct: 25,
    }),
    strategyRow('s-roi-2', {
      subscriberCount: 300,
      publishedAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
      targetRoiPct: 25,
    }),
    strategyRow('s-archived', {
      status: 'archived',
      subscriberCount: 9999,
      publishedAt: '2026-03-14T00:00:00.000Z',
      updatedAt: '2026-03-14T00:00:00.000Z',
    }),
  ];
  const now = '2026-03-15T00:00:00.000Z';

  it('defaults to hot, ranking log-scaled demand with freshness and hiding archived strategies', () => {
    // Hot scores at 2026-03-15: s-followers log10(501)*20 = 53.9968 + 0 (73 days old),
    // s-roi-2 log10(301)*20 = 49.5714 + 0, s-roi-1 log10(101)*20 = 40.0864 + 0,
    // s-hot log10(10)*20 + (30 - 14) = 36, s-recent log10(2)*20 + 0 = 6.0206.
    expect(sortStrategyFeed(strategies, { now }).map((s) => s.id)).toEqual([
      's-followers',
      's-roi-2',
      's-roi-1',
      's-hot',
      's-recent',
    ]);
  });

  it('sorts by follower count with newest publication as the first tie-breaker', () => {
    expect(
      sortStrategyFeed(strategies, { by: 'followers', now }).map((s) => s.id),
    ).toEqual(['s-followers', 's-roi-2', 's-roi-1', 's-hot', 's-recent']);
  });

  it('sorts by most recent update', () => {
    expect(
      sortStrategyFeed(strategies, { by: 'recent', now }).map((s) => s.id),
    ).toEqual(['s-recent', 's-hot', 's-roi-2', 's-roi-1', 's-followers']);
  });

  it('sorts by target ROI with followers as the tie-breaker', () => {
    expect(
      sortStrategyFeed(strategies, { by: 'roi', now }).map((s) => s.id),
    ).toEqual(['s-roi-2', 's-roi-1', 's-hot', 's-followers', 's-recent']);
  });

  it('applies the limit after sorting', () => {
    expect(
      sortStrategyFeed(strategies, { by: 'followers', now, limit: 2 }).map((s) => s.id),
    ).toEqual(['s-followers', 's-roi-2']);
  });

  it('breaks exact ties by ascending id', () => {
    const tied = [
      strategyRow('b', { publishedAt: '2026-01-01T00:00:00.000Z', subscriberCount: 4 }),
      strategyRow('a', { publishedAt: '2026-01-01T00:00:00.000Z', subscriberCount: 4 }),
    ];
    expect(sortStrategyFeed(tied, { by: 'followers', now }).map((s) => s.id)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('strategiesByAuthor', () => {
  it('filters by author and orders by version descending, id ascending', () => {
    const rows: SharedStrategy[] = [
      strategyRow('a-v1', { authorId: 'trader-a', version: 1 }),
      strategyRow('y-v2', { authorId: 'trader-a', version: 2 }),
      strategyRow('w-v2', { authorId: 'trader-a', version: 2 }),
      strategyRow('b-other', { authorId: 'trader-b', version: 9 }),
    ];
    expect(strategiesByAuthor(rows, 'trader-a').map((s) => s.id)).toEqual([
      'w-v2',
      'y-v2',
      'a-v1',
    ]);
  });

  it('returns an empty list for an unknown author', () => {
    expect(strategiesByAuthor([strategyRow('a-v1')], 'ghost')).toEqual([]);
  });
});
