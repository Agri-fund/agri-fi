import { beforeEach, describe, expect, it } from 'vitest';

import {
  FOLLOW_GRAPH_VERSION,
  FOLLOW_STORAGE_KEY,
  SUGGESTION_WEIGHTS,
  clearFollowGraph,
  createFollowGraph,
  follow,
  followedTraderIds,
  followerCount,
  isFollowing,
  listFollowers,
  listFollowing,
  loadFollowGraph,
  mutualFollows,
  normalizeFollowGraph,
  saveFollowGraph,
  suggestTraders,
  unfollow,
} from '../follow';
import type { FollowRelationship, TraderProfile } from '../types';

function rel(
  followerId: string,
  traderId: string,
  followedAt: string,
  source: FollowRelationship['source'] = 'profile',
): FollowRelationship {
  return { followerId, traderId, followedAt, source };
}

interface CandidateSpec {
  roi: number;
  tenureMonths?: number;
  sortino?: number;
  verified?: boolean;
  sectors?: string[];
  regions?: string[];
}

function candidate(traderId: string, spec: CandidateSpec): TraderProfile {
  return {
    traderId,
    displayName: `Trader ${traderId}`,
    focusSectors: spec.sectors ?? [],
    regions: spec.regions ?? [],
    verified: spec.verified ?? false,
    metrics: {
      realizedRoiPct: spec.roi,
      tenureMonths: spec.tenureMonths ?? 0,
      sortino: spec.sortino ?? 0,
    },
  } as unknown as TraderProfile;
}

const INTERESTS = ['Coffee', 'Kenya'];

const PROFILES: TraderProfile[] = [
  candidate('a', { roi: 20, sectors: ['Coffee'], regions: ['Kenya'], verified: true, tenureMonths: 24, sortino: 1.5 }),
  candidate('b', { roi: 10, sectors: ['Maize'], regions: ['Kenya'], verified: true, tenureMonths: 12, sortino: 0.5 }),
  candidate('c', { roi: 5, sectors: ['Coffee'], regions: ['Tanzania'], tenureMonths: 48, sortino: 2 }),
];

describe('graph construction', () => {
  it('starts empty and versioned', () => {
    expect(createFollowGraph()).toEqual({ version: FOLLOW_GRAPH_VERSION, relationships: [] });
    expect(FOLLOW_GRAPH_VERSION).toBe(1);
  });

  it('drops self edges and blank ids', () => {
    const graph = normalizeFollowGraph({
      version: 1,
      relationships: [rel('f1', 'f1', '2026-01-01'), rel('', 't1', '2026-01-01'), rel('f1', 't1', '2026-01-01')],
    });
    expect(graph.relationships).toEqual([rel('f1', 't1', '2026-01-01')]);
  });

  it('keeps the earliest duplicate edge and sorts deterministically', () => {
    const graph = createFollowGraph([
      rel('f1', 't2', '2026-03-01', 'leaderboard'),
      rel('f1', 't1', '2026-02-01', 'strategy'),
      rel('f1', 't1', '2026-01-01', 'profile'),
      rel('f1', 't1', '2026-05-01', 'suggestion'),
    ]);
    expect(graph.relationships).toEqual([
      rel('f1', 't1', '2026-01-01', 'profile'),
      rel('f1', 't2', '2026-03-01', 'leaderboard'),
    ]);
  });

  it('stamps the current version on legacy payloads', () => {
    expect(normalizeFollowGraph({ version: 0, relationships: [] }).version).toBe(1);
  });
});

describe('follow / unfollow', () => {
  it('adds an edge with the requested source and timestamp', () => {
    const graph = follow(createFollowGraph(), 'f1', 't1', {
      source: 'leaderboard',
      at: '2026-06-01T00:00:00.000Z',
    });
    expect(graph.relationships).toEqual([
      { followerId: 'f1', traderId: 't1', followedAt: '2026-06-01T00:00:00.000Z', source: 'leaderboard' },
    ]);
  });

  it('defaults to the profile source', () => {
    const graph = follow(createFollowGraph(), 'f1', 't1', { at: '2026-06-01' });
    expect(graph.relationships[0].source).toBe('profile');
  });

  it('is idempotent and never mutates the input graph', () => {
    const start = createFollowGraph([rel('f1', 't1', '2026-01-01')]);
    const again = follow(start, 'f1', 't1', { at: '2026-02-01', source: 'suggestion' });
    expect(again).toBe(start);
    expect(start.relationships).toHaveLength(1);
  });

  it('removes only the requested edge', () => {
    const start = createFollowGraph([rel('f1', 't1', '2026-01-01'), rel('f2', 't1', '2026-02-01')]);
    const graph = unfollow(start, 'f1', 't1');
    expect(graph.relationships).toEqual([rel('f2', 't1', '2026-02-01')]);
    expect(start.relationships).toHaveLength(2);
    expect(unfollow(graph, 'f9', 't9').relationships).toEqual(graph.relationships);
  });
});

describe('queries', () => {
  const graph = createFollowGraph([
    rel('f1', 't1', '2026-03-01'),
    rel('f2', 't1', '2026-01-01'),
    rel('f1', 't2', '2026-02-01'),
    rel('t1', 'f1', '2026-04-01'),
  ]);

  it('answers edge lookups', () => {
    expect(isFollowing(graph, 'f1', 't1')).toBe(true);
    expect(isFollowing(graph, 't1', 'f1')).toBe(true);
    expect(isFollowing(graph, 'f2', 't2')).toBe(false);
  });

  it('lists followers oldest first and following oldest first', () => {
    expect(listFollowers(graph, 't1').map((r) => r.followerId)).toEqual(['f2', 'f1']);
    expect(listFollowing(graph, 'f1').map((r) => r.traderId)).toEqual(['t2', 't1']);
    expect(followedTraderIds(graph, 'f1')).toEqual(['t2', 't1']);
    expect(followerCount(graph, 't1')).toBe(2);
    expect(followerCount(graph, 't2')).toBe(1);
    expect(followedTraderIds(graph, 'nobody')).toEqual([]);
  });

  it('detects one-way and mutual edges', () => {
    expect(mutualFollows(graph, 'f1', 't1')).toEqual({
      aFollowsB: true,
      bFollowsA: true,
      mutual: true,
    });
    expect(mutualFollows(graph, 'f2', 't1')).toEqual({
      aFollowsB: true,
      bFollowsA: false,
      mutual: false,
    });
    expect(mutualFollows(graph, 'f2', 't2').mutual).toBe(false);
  });
});

describe('suggestTraders', () => {
  it('weights interest overlap, rank, tenure and verification', () => {
    expect(SUGGESTION_WEIGHTS).toEqual({
      interestOverlap: 45,
      rank: 30,
      tenure: 15,
      verification: 10,
    });
    const suggestions = suggestTraders(PROFILES, INTERESTS, [], { limit: 3 });
    expect(suggestions.map((s) => [s.traderId, s.score])).toEqual([
      ['a', 100],
      ['b', 55],
      ['c', 37.5],
    ]);
  });

  it('explains each suggestion with the legs that earned points', () => {
    const [top] = suggestTraders(PROFILES, INTERESTS, [], { limit: 1 });
    expect(top.reasons).toEqual([
      'Matches 100% of your interests (Coffee)',
      'Top-tier ROI (20%)',
      '24 months of history',
      'KYC-verified trader',
      'Sortino 1.5',
    ]);
    const [, second] = suggestTraders(PROFILES, INTERESTS, [], { limit: 2 });
    expect(second.reasons).toEqual([
      'Matches 50% of your interests (Maize)',
      '12 months of history',
      'KYC-verified trader',
    ]);
  });

  it('excludes ids already followed', () => {
    expect(suggestTraders(PROFILES, INTERESTS, ['b'], { limit: 5 }).map((s) => s.traderId)).toEqual([
      'a',
      'c',
    ]);
  });

  it('excludes a graph scoped to the requesting follower', () => {
    const graph = createFollowGraph([rel('f1', 'a', '2026-01-01'), rel('f2', 'c', '2026-01-01')]);
    expect(
      suggestTraders(PROFILES, INTERESTS, graph, { limit: 5, followerId: 'f1' }).map((s) => s.traderId),
    ).toEqual(['b', 'c']);
    // Without a follower id every trader present in the graph is excluded.
    expect(suggestTraders(PROFILES, INTERESTS, graph, { limit: 5 }).map((s) => s.traderId)).toEqual([
      'b',
    ]);
  });

  it('caps the tenure leg at 24 months', () => {
    const scoreAlone = (spec: CandidateSpec) => suggestTraders([candidate('x', spec)], [], [])[0].score;
    // A lone candidate earns the full 30-point rank leg plus 15 tenure points at 24 months.
    expect(scoreAlone({ roi: 10, tenureMonths: 24 })).toBe(45);
    expect(scoreAlone({ roi: 10, tenureMonths: 60 })).toBe(45);
    expect(scoreAlone({ roi: 10, tenureMonths: 8 })).toBe(35);
    expect(scoreAlone({ roi: 10, tenureMonths: 24, verified: true })).toBe(55);
    expect(suggestTraders(PROFILES, INTERESTS, [], { limit: 2 })).toHaveLength(2);
    expect(suggestTraders(PROFILES, INTERESTS, [])).toHaveLength(3);
  });

  it('scores nothing on an empty interest list but still ranks on ROI', () => {
    const suggestions = suggestTraders(PROFILES, [], [], { limit: 3 });
    // 30 (rank) + 15 (tenure) + 10 (verified) for the ROI leader.
    expect(suggestions[0]).toMatchObject({ traderId: 'a', score: 55 });
    expect(suggestions[0].reasons).not.toContain('Matches 100% of your interests (Coffee)');
    expect(suggestions.map((s) => s.traderId)).toEqual(['a', 'b', 'c']);
  });

  it('orders equal-ROI candidates deterministically by trader id', () => {
    const twins = [
      candidate('z', { roi: 10, tenureMonths: 24 }),
      candidate('y', { roi: 10, tenureMonths: 24 }),
    ];
    const suggestions = suggestTraders(twins, [], [], { limit: 2 });
    // The lower id takes the top rank leg, so the board never flips between runs.
    expect(suggestions.map((s) => [s.traderId, s.score])).toEqual([
      ['y', 45],
      ['z', 15],
    ]);
  });

  it('handles an empty candidate pool', () => {
    expect(suggestTraders([], INTERESTS, [])).toEqual([]);
  });
});

describe('persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips through the versioned storage key', () => {
    const graph = createFollowGraph([rel('f1', 't1', '2026-01-01'), rel('f1', 'f1', '2026-01-01')]);
    expect(saveFollowGraph(graph)).toBe(true);
    expect(localStorage.getItem(FOLLOW_STORAGE_KEY)).toContain('"version":1');
    expect(loadFollowGraph()).toEqual(graph);
  });

  it('returns an empty graph when nothing is stored', () => {
    expect(loadFollowGraph()).toEqual({ version: 1, relationships: [] });
  });

  it('survives corrupt and malformed payloads', () => {
    localStorage.setItem(FOLLOW_STORAGE_KEY, 'not json');
    expect(loadFollowGraph()).toEqual({ version: 1, relationships: [] });
    localStorage.setItem(FOLLOW_STORAGE_KEY, JSON.stringify({ version: 1, relationships: 'nope' }));
    expect(loadFollowGraph()).toEqual({ version: 1, relationships: [] });
  });

  it('clears the stored graph', () => {
    saveFollowGraph(createFollowGraph([rel('f1', 't1', '2026-01-01')]));
    clearFollowGraph();
    expect(loadFollowGraph().relationships).toEqual([]);
  });

  it('reports failure when storage throws', () => {
    const failing = { setItem: () => { throw new Error('quota'); } };
    Object.defineProperty(global, 'localStorage', { value: failing, writable: true });
    expect(saveFollowGraph(createFollowGraph())).toBe(false);
    Object.defineProperty(global, 'localStorage', {
      value: { getItem: () => { throw new Error('blocked'); } },
      writable: true,
    });
    expect(loadFollowGraph()).toEqual({ version: 1, relationships: [] });
  });
});
