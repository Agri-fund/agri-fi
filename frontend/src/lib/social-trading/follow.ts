/**
 * Follow graph for social trading (issue #1212).
 *
 * Relationships are stored client-side under a versioned localStorage key so the
 * graph survives reloads before a backend endpoint exists. Every mutator is pure
 * (returns a new graph) so the reducer logic is trivially unit-testable.
 */

import type {
  FollowRelationship,
  SuggestedTrader,
  TraderProfile,
} from './types';

export const FOLLOW_STORAGE_KEY = 'agrifi.social-trading.follow.v1';
export const FOLLOW_GRAPH_VERSION = 1;

export interface FollowGraph {
  version: number;
  relationships: FollowRelationship[];
}

export const SUGGESTION_WEIGHTS = {
  interestOverlap: 45,
  rank: 30,
  tenure: 15,
  verification: 10,
} as const;

/** Tenure (months) at which a trader earns the full tenure leg of a suggestion. */
const TENURE_CAP_MONTHS = 24;

function edgeKey(followerId: string, traderId: string): string {
  return `${followerId}::${traderId}`;
}

export function createFollowGraph(
  relationships: FollowRelationship[] = [],
): FollowGraph {
  return normalizeFollowGraph({
    version: FOLLOW_GRAPH_VERSION,
    relationships,
  });
}

/** Drops self-edges and duplicate (follower, trader) pairs, keeping the earliest. */
export function normalizeFollowGraph(graph: FollowGraph): FollowGraph {
  const seen = new Map<string, FollowRelationship>();
  for (const rel of graph.relationships ?? []) {
    if (!rel?.followerId || !rel?.traderId) continue;
    if (rel.followerId === rel.traderId) continue;
    const key = edgeKey(rel.followerId, rel.traderId);
    const existing = seen.get(key);
    if (
      !existing ||
      new Date(rel.followedAt).getTime() < new Date(existing.followedAt).getTime()
    ) {
      seen.set(key, rel);
    }
  }
  const relationships = [...seen.values()].sort((a, b) =>
    edgeKey(a.followerId, a.traderId).localeCompare(edgeKey(b.followerId, b.traderId)),
  );
  return { version: FOLLOW_GRAPH_VERSION, relationships };
}

export function follow(
  graph: FollowGraph,
  followerId: string,
  traderId: string,
  options: {
    source?: FollowRelationship['source'];
    at?: string;
  } = {},
): FollowGraph {
  if (isFollowing(graph, followerId, traderId)) return graph;
  return normalizeFollowGraph({
    ...graph,
    relationships: [
      ...graph.relationships,
      {
        followerId,
        traderId,
        followedAt: options.at ?? new Date().toISOString(),
        source: options.source ?? 'profile',
      },
    ],
  });
}

export function unfollow(
  graph: FollowGraph,
  followerId: string,
  traderId: string,
): FollowGraph {
  return normalizeFollowGraph({
    ...graph,
    relationships: graph.relationships.filter(
      (rel) => !(rel.followerId === followerId && rel.traderId === traderId),
    ),
  });
}

export function isFollowing(
  graph: FollowGraph,
  followerId: string,
  traderId: string,
): boolean {
  return graph.relationships.some(
    (rel) => rel.followerId === followerId && rel.traderId === traderId,
  );
}

/** Investors that follow the given trader. */
export function listFollowers(
  graph: FollowGraph,
  traderId: string,
): FollowRelationship[] {
  return graph.relationships
    .filter((rel) => rel.traderId === traderId)
    .sort((a, b) => a.followedAt.localeCompare(b.followedAt));
}

/** Traders the given investor follows. */
export function listFollowing(
  graph: FollowGraph,
  followerId: string,
): FollowRelationship[] {
  return graph.relationships
    .filter((rel) => rel.followerId === followerId)
    .sort((a, b) => a.followedAt.localeCompare(b.followedAt));
}

export function followerCount(graph: FollowGraph, traderId: string): number {
  return listFollowers(graph, traderId).length;
}

export interface MutualFollowResult {
  aFollowsB: boolean;
  bFollowsA: boolean;
  mutual: boolean;
}

export function mutualFollows(
  graph: FollowGraph,
  idA: string,
  idB: string,
): MutualFollowResult {
  const aFollowsB = isFollowing(graph, idA, idB);
  const bFollowsA = isFollowing(graph, idB, idA);
  return { aFollowsB, bFollowsA, mutual: aFollowsB && bFollowsA };
}

export function followedTraderIds(graph: FollowGraph, followerId: string): string[] {
  return listFollowing(graph, followerId).map((rel) => rel.traderId);
}

/**
 * Accepts either a list of ids or a graph. With a graph and no `followerId` every
 * trader in the graph is excluded, which is what a single-user store wants.
 */
function toFollowedSet(
  existing: string[] | FollowGraph,
  followerId?: string,
): Set<string> {
  if (Array.isArray(existing)) return new Set(existing);
  if (followerId) return new Set(followedTraderIds(existing, followerId));
  return new Set(existing.relationships.map((rel) => rel.traderId));
}

function overlapRatio(interests: string[], candidate: TraderProfile): number {
  if (interests.length === 0) return 0;
  const haystack = new Set(
    [...candidate.focusSectors, ...candidate.regions].map((s) =>
      s.toLowerCase(),
    ),
  );
  const hits = interests.filter((interest) =>
    haystack.has(interest.toLowerCase()),
  ).length;
  return hits / interests.length;
}

export function suggestTraders(
  profiles: TraderProfile[],
  myInterests: string[],
  existing: string[] | FollowGraph,
  options: { limit?: number; followerId?: string } = {},
): SuggestedTrader[] {
  const followed = toFollowedSet(existing, options.followerId);
  const limit = options.limit ?? 3;

  // Rank leg is derived from raw ROI standing, so the leaderboard order and the
  // suggestion order agree even when the caller has no leaderboard handy.
  const ranked = [...profiles].sort(
    (a, b) =>
      b.metrics.realizedRoiPct - a.metrics.realizedRoiPct ||
      a.traderId.localeCompare(b.traderId),
  );
  const divisor = Math.max(ranked.length - 1, 1);

  const suggestions: SuggestedTrader[] = [];
  ranked.forEach((profile, index) => {
    if (followed.has(profile.traderId)) return;

    const overlap = overlapRatio(myInterests, profile);
    const rankScore = 1 - index / divisor;
    const tenureScore = Math.min(profile.metrics.tenureMonths / TENURE_CAP_MONTHS, 1);
    const score =
      SUGGESTION_WEIGHTS.interestOverlap * overlap +
      SUGGESTION_WEIGHTS.rank * rankScore +
      SUGGESTION_WEIGHTS.tenure * tenureScore +
      SUGGESTION_WEIGHTS.verification * (profile.verified ? 1 : 0);

    const reasons: string[] = [];
    if (overlap > 0)
      reasons.push(
        `Matches ${Math.round(overlap * 100)}% of your interests (${profile.focusSectors.join(', ')})`,
      );
    if (rankScore >= 0.66) reasons.push(`Top-tier ROI (${profile.metrics.realizedRoiPct}%)`);
    if (tenureScore >= 0.5) reasons.push(`${profile.metrics.tenureMonths} months of history`);
    if (profile.verified) reasons.push('KYC-verified trader');
    if (profile.metrics.sortino >= 1) reasons.push(`Sortino ${profile.metrics.sortino}`);

    suggestions.push({
      traderId: profile.traderId,
      displayName: profile.displayName,
      score: Math.round(score * 100) / 100,
      reasons,
    });
  });

  return suggestions
    .sort(
      (a, b) =>
        b.score - a.score || a.traderId.localeCompare(b.traderId),
    )
    .slice(0, limit);
}

/** SSR-safe read; returns an empty graph when unavailable or corrupt. */
export function loadFollowGraph(): FollowGraph {
  if (typeof window === 'undefined') return createFollowGraph();
  try {
    const raw = window.localStorage.getItem(FOLLOW_STORAGE_KEY);
    if (!raw) return createFollowGraph();
    const parsed = JSON.parse(raw) as Partial<FollowGraph>;
    if (!Array.isArray(parsed.relationships)) return createFollowGraph();
    return normalizeFollowGraph({
      version: parsed.version ?? FOLLOW_GRAPH_VERSION,
      relationships: parsed.relationships,
    });
  } catch {
    return createFollowGraph();
  }
}

/** Best-effort persistence; returns false when storage is unavailable. */
export function saveFollowGraph(graph: FollowGraph): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(
      FOLLOW_STORAGE_KEY,
      JSON.stringify(normalizeFollowGraph(graph)),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearFollowGraph(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(FOLLOW_STORAGE_KEY);
  } catch {
    // nothing to do
  }
}
