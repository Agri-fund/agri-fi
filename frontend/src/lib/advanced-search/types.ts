import type { Deal } from '@/lib/api';

/**
 * Structured search filters produced by the natural-language parser and
 * consumed by the pre-screen, ranking and explanation stages.
 */
export interface SearchFilters {
  commodity?: string[];
  excludeCommodity?: string[];
  region?: string[];
  country?: string[];
  excludeCountry?: string[];
  excludeRegion?: string[];
  risk?: Array<'Low' | 'Medium' | 'High'>;
  excludeRisk?: Array<'Low' | 'Medium' | 'High'>;
  status?: Deal['status'][];
  roiMin?: number;
  roiMax?: number;
  termDaysMin?: number;
  termDaysMax?: number;
  esgMin?: number;
  esgMax?: number;
  quantityMin?: number;
  quantityMax?: number;
  valueMin?: number;
  valueMax?: number;
  createdAfter?: string;
  createdBefore?: string;
}

export type SearchIntent =
  | 'browse'
  | 'question'
  | 'compare'
  | 'recommend'
  | 'filter'
  | 'recency';

/** The result of parsing a raw natural-language query into structured parts. */
export interface ParsedQuery {
  rawQuery: string;
  terms: string[];
  exactPhrase?: string;
  filters: SearchFilters;
  intents: SearchIntent[];
}

/** Dense, L2-normalised semantic vector for a deal document or query. */
export type SemanticVector = number[];

/** Per-component contribution to a result's final relevance score. */
export interface ScoreBreakdown {
  lexical: number;
  semantic: number;
  filter: number;
  freshness: number;
  funding: number;
  roi: number;
  behavior: number;
  diversityPenalty: number;
  total: number;
}

/** A single "why did this match" reason, with the field and evidence backing it. */
export interface ExplanationReason {
  reason: string;
  field: string;
  evidence: string;
}

/** A ranked, explainable search result. */
export interface RankedResult {
  deal: Deal;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  explanation: ExplanationReason[];
}

export interface FacetValue {
  value: string;
  label: string;
  count: number;
}

export interface Facet {
  id: string;
  label: string;
  values: FacetValue[];
}

/** Selected facet values keyed by facet id. OR within a group, AND across groups. */
export type FacetSelection = Record<string, string[]>;

/** Optional per-deal user behaviour signals used to bias ranking. */
export type UserBehaviorSignal = { clicks?: number; investments?: number };
export type UserBehaviorMap = Record<string, UserBehaviorSignal>;

export interface AdvancedSearchOptions {
  topK?: number;
  behavior?: UserBehaviorMap;
  /** Restrict scoring to these deal ids (used by the pre-screen stage). */
  candidateIds?: string[];
  /** Facet selection applied to the returned results. */
  selectedFacets?: FacetSelection;
  /** Overridable "now" timestamp (ms) so freshness scoring is deterministic. */
  now?: number;
}

/** Timing + volume statistics for a single search execution. */
export interface SearchExecutionStats {
  latencyMs: number;
  resultCount: number;
  indexSize: number;
  stages: {
    parse: number;
    index: number;
    screen: number;
    score: number;
    rank: number;
    explain: number;
    facet: number;
    total: number;
  };
}

/** The full outcome of an advanced search run. */
export interface AdvancedSearchResult {
  parsed: ParsedQuery;
  results: RankedResult[];
  facets: Facet[];
  explanationOfQuery: string[];
  stats: SearchExecutionStats;
}

/** A record stored in search history (localStorage-backed). */
export interface HistoryEntry {
  id: string;
  raw: string;
  at: number;
  count: number;
  resultCount: number;
  latencyMs: number;
}

/** A query the user explicitly saved. */
export interface SavedQuery {
  id: string;
  raw: string;
  savedAt: number;
  note?: string;
}

/** A single logged search, used to build analytics. */
export interface SearchAnalyticsRecord {
  raw: string;
  resultCount: number;
  latencyMs: number;
  at: number;
}

/** Aggregate analytics summary. */
export interface SearchAnalyticsSummary {
  totalQueries: number;
  zeroResultQueries: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  subSecondRate: number;
  topQueries: FacetValue[];
  zeroResultQueryList: FacetValue[];
}

export type SuggestionKind =
  | 'commodity'
  | 'region'
  | 'template'
  | 'field'
  | 'recent'
  | 'value';

export interface SearchSuggestion {
  text: string;
  kind: SuggestionKind;
  score: number;
}
