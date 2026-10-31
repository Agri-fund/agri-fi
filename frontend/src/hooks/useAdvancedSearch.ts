'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Deal } from '@/lib/api';
import { SAMPLE_DEALS } from '@/lib/advanced-search/sample-deals';
import { runAdvancedSearch, similarDealsTo } from '@/lib/advanced-search/engine';
import { getSuggestions } from '@/lib/advanced-search/suggestions';
import { getHistory, recordQuery } from '@/lib/advanced-search/search-history';
import { logQuery, getAnalytics } from '@/lib/advanced-search/search-analytics';
import type { SimilarHit } from '@/lib/advanced-search/embeddings';
import type {
  AdvancedSearchResult,
  ExplanationReason,
  Facet,
  FacetSelection,
  RankedResult,
  SearchAnalyticsSummary,
  SearchExecutionStats,
  SearchSuggestion,
  UserBehaviorMap,
} from '@/lib/advanced-search/types';

export interface UseAdvancedSearchOptions {
  /** Supply deals directly (e.g. a fixture or a caller-owned query). When set,
   *  the marketplace API is not called. */
  deals?: Deal[];
  /** Debounce window for the query text before searching. Defaults to 300ms. */
  debounceMs?: number;
  /** Max ranked results to return. */
  topK?: number;
  /** Per-deal behaviour signals used to bias ranking. */
  behavior?: UserBehaviorMap;
  /** Set false to skip the automatic getOpenDeals fetch (caller drives data). */
  autoFetch?: boolean;
}

const EMPTY_STATS: SearchExecutionStats = {
  latencyMs: 0,
  resultCount: 0,
  indexSize: 0,
  stages: { parse: 0, index: 0, screen: 0, score: 0, rank: 0, explain: 0, facet: 0, total: 0 },
};

export interface UseAdvancedSearchReturn {
  query: string;
  setQuery: (value: string) => void;
  parsed: AdvancedSearchResult['parsed'] | null;
  results: RankedResult[];
  facets: Facet[];
  selectedFacets: FacetSelection;
  toggleFacet: (groupId: string, value: string) => void;
  clearFacets: () => void;
  suggestions: SearchSuggestion[];
  loading: boolean;
  stats: SearchExecutionStats;
  explain: (dealId: string) => ExplanationReason[];
  interpretedAs: string[];
  zeroResults: boolean;
  usingFallbackData: boolean;
  analytics: SearchAnalyticsSummary;
  similarDeals: (dealId: string, topK?: number) => SimilarHit[];
}

/**
 * Client hook wrapping the advanced-search engine: debounced natural-language
 * input, a remembered (memoized) index across queries, faceted refinement,
 * autocomplete suggestions, plus search-history and analytics recording.
 */
export function useAdvancedSearch(
  options: UseAdvancedSearchOptions = {},
): UseAdvancedSearchReturn {
  const { deals: explicitDeals, debounceMs = 300, topK = 50, behavior, autoFetch = true } = options;

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedFacets, setSelectedFacets] = useState<FacetSelection>({});
  const [sourceDeals, setSourceDeals] = useState<Deal[] | null>(explicitDeals ?? null);
  const [usingFallbackData, setUsingFallbackData] = useState(false);
  const [search, setSearch] = useState<AdvancedSearchResult | null>(null);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [analytics, setAnalytics] = useState<SearchAnalyticsSummary>(() => getAnalytics());

  const lastRecordedQuery = useRef<string | null>(null);

  // 1. Debounce the raw query text.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), debounceMs);
    return () => clearTimeout(timer);
  }, [query, debounceMs]);

  // 2. Resolve the searchable deal source.
  useEffect(() => {
    if (explicitDeals) {
      setSourceDeals(explicitDeals);
      setUsingFallbackData(false);
      return;
    }
    if (!autoFetch) return;
    let active = true;
    setLoading(true);
    (async () => {
      try {
        // getOpenDeals is loaded lazily so an unreachable or broken API module
        // degrades to bundled sample data instead of crashing the search page.
        const { getOpenDeals } = await import('@/lib/api');
        const page = await getOpenDeals(1, 200);
        if (!active) return;
        setSourceDeals(page.data);
        setUsingFallbackData(false);
      } catch (err) {
        if (!active) return;
        // Explicit, non-silent fallback so demos/tests run without a live API.
        console.warn(
          '[advanced-search] getOpenDeals failed — falling back to bundled SAMPLE_DEALS',
          err,
        );
        setSourceDeals(SAMPLE_DEALS);
        setUsingFallbackData(true);
      }
    })()
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [explicitDeals, autoFetch]);

  // 3. Autocomplete suggestions react to the live (undebounced) query.
  useEffect(() => {
    setSuggestions(
      getSuggestions(query, {
        recentQueries: getHistory().map((h) => h.raw),
      }),
    );
  }, [query]);

  // 4. Run the engine whenever the debounced query, data, or facets change.
  useEffect(() => {
    if (!sourceDeals) return;
    setLoading(true);
    const result = runAdvancedSearch(sourceDeals, debouncedQuery, {
      topK,
      behavior,
      selectedFacets,
    });
    setSearch(result);
    setLoading(false);

    // Record history + analytics once per settled query text, not on facet
    // toggles (which reuse the same query string).
    if (debouncedQuery.trim() && lastRecordedQuery.current !== debouncedQuery) {
      lastRecordedQuery.current = debouncedQuery;
      recordQuery(debouncedQuery, {
        resultCount: result.stats.resultCount,
        latencyMs: result.stats.latencyMs,
      });
      logQuery({
        raw: debouncedQuery,
        resultCount: result.stats.resultCount,
        latencyMs: result.stats.latencyMs,
        at: Date.now(),
      });
      setAnalytics(getAnalytics());
    }
  }, [debouncedQuery, sourceDeals, selectedFacets, topK, behavior]);

  const toggleFacet = useCallback((groupId: string, value: string) => {
    setSelectedFacets((prev) => {
      const current = prev[groupId] ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      const out: FacetSelection = { ...prev, [groupId]: next };
      if (next.length === 0) delete out[groupId];
      return out;
    });
  }, []);

  const clearFacets = useCallback(() => setSelectedFacets({}), []);

  const results = search?.results ?? [];

  const explain = useCallback(
    (dealId: string): ExplanationReason[] =>
      results.find((r) => r.deal.id === dealId)?.explanation ?? [],
    [results],
  );

  const similarDeals = useCallback(
    (dealId: string, count = 3): SimilarHit[] =>
      sourceDeals ? similarDealsTo(sourceDeals, dealId, count) : [],
    [sourceDeals],
  );

  const zeroResults = useMemo(
    () => debouncedQuery.trim().length > 0 && results.length === 0,
    [debouncedQuery, results.length],
  );

  return {
    query,
    setQuery,
    parsed: search?.parsed ?? null,
    results,
    facets: search?.facets ?? [],
    selectedFacets,
    toggleFacet,
    clearFacets,
    suggestions,
    loading,
    stats: search?.stats ?? EMPTY_STATS,
    explain,
    interpretedAs: search?.explanationOfQuery ?? [],
    zeroResults,
    usingFallbackData,
    analytics,
    similarDeals,
  };
}
