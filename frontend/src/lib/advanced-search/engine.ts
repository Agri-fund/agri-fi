import type { Deal } from '@/lib/api';
import type {
  AdvancedSearchOptions,
  AdvancedSearchResult,
  RankedResult,
  SearchExecutionStats,
} from './types';
import { parseQuery, filtersToHumanReadable } from './query-parser';
import { buildIndex, mostSimilar, type EmbeddingIndex, type SimilarHit } from './embeddings';
import { scoreAndRank, passesFilters } from './ranking';
import { buildFacets, applyFacets } from './facets';

/** Sub-second latency target asserted by tests and shown in analytics. */
export const LATENCY_BUDGET_MS = 1000;

/** Default cap on returned ranked results. */
export const DEFAULT_TOP_K = 50;

/** Maximum number of memoized indexes retained in-session. */
const INDEX_CACHE_LIMIT = 6;

const indexCache = new Map<string, EmbeddingIndex>();

// High-resolution timer with a monotonic-ish fallback for environments without
// the Performance API (older SSR runtimes, minimal jsdom).
const hasPerformance =
  typeof performance !== 'undefined' && typeof performance.now === 'function';
function now(): number {
  return hasPerformance ? performance.now() : Date.now();
}

/**
 * Cheap, order-independent content signature so repeated searches against an
 * unchanged deal-set reuse the same index instead of rebuilding embeddings.
 * Includes fields that materially affect the embedding document.
 */
export function indexSignature(deals: Deal[]): string {
  let h = 0x811c9dc5;
  const ids = deals.map((d) => d.id).sort();
  const body = deals
    .map((d) => `${d.id}:${d.commodity}:${d.status}:${d.total_value}:${d.created_at ?? ''}`)
    .sort()
    .join('|');
  const text = `${ids.length}:${body}`;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${deals.length}:${(h >>> 0).toString(36)}`;
}

/** Get (memoized) or build the embedding index for a deal-set. */
export function getIndex(deals: Deal[]): EmbeddingIndex {
  const signature = indexSignature(deals);
  const cached = indexCache.get(signature);
  if (cached) return cached;
  const built = buildIndex(deals);
  indexCache.set(signature, built);
  if (indexCache.size > INDEX_CACHE_LIMIT) {
    const oldest = indexCache.keys().next().value;
    if (oldest) indexCache.delete(oldest);
  }
  return built;
}

/** Drop memoized indexes (used by tests / when switching data sources). */
export function resetIndexCache(): void {
  indexCache.clear();
}

/**
 * Run the full advanced-search pipeline: parse -> memoized index -> filter
 * pre-screen -> semantic + lexical scoring -> rank -> explain -> facet.
 */
export function runAdvancedSearch(
  deals: Deal[],
  raw: string,
  options: AdvancedSearchOptions = {},
): AdvancedSearchResult {
  const totalStart = now();

  const parseStart = now();
  const parsed = parseQuery(raw);
  const parseMs = now() - parseStart;

  const indexStart = now();
  const index = getIndex(deals);
  const indexMs = now() - indexStart;

  const screenStart = now();
  const hasHardFilters = Object.keys(parsed.filters).length > 0;
  const candidateIds = hasHardFilters
    ? deals.filter((d) => passesFilters(d, parsed.filters)).map((d) => d.id)
    : deals.map((d) => d.id);
  const screenMs = now() - screenStart;

  // scoreAndRank folds scoring + ranking + per-result explanation into one pass.
  const scoreStart = now();
  const ranked = scoreAndRank(index, parsed, { ...options, candidateIds });
  const scoreMs = now() - scoreStart;

  const facetStart = now();
  const facets = buildFacets(ranked);
  const selected = options.selectedFacets ?? {};
  const refined = applyFacets(ranked, selected);
  const facetMs = now() - facetStart;

  const topK = options.topK ?? DEFAULT_TOP_K;
  const results = refined.slice(0, topK);
  const totalMs = now() - totalStart;

  const stats: SearchExecutionStats = {
    latencyMs: round(totalMs),
    resultCount: results.length,
    indexSize: index.items.length,
    stages: {
      parse: round(parseMs),
      index: round(indexMs),
      screen: round(screenMs),
      score: round(scoreMs),
      rank: 0,
      explain: 0,
      facet: round(facetMs),
      total: round(totalMs),
    },
  };

  return {
    parsed,
    results,
    facets,
    explanationOfQuery: filtersToHumanReadable(parsed),
    stats,
  };
}

/** Similar-deal affordance backed by the same memoized index. */
export function similarDealsTo(
  deals: Deal[],
  dealId: string,
  topK = 3,
): SimilarHit[] {
  return mostSimilar(getIndex(deals), dealId, topK);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export type { AdvancedSearchResult, RankedResult };
