# Advanced Search — Natural-Language & Semantic Deal Discovery

AgriFi Advanced Search lets investors and traders query the marketplace in plain
language ("show me cocoa deals in Africa with ROI above 15%") instead of fiddling
with a keyword box and a wall of filter controls. The engine parses the sentence
into structured filters, ranks every deal by a blend of lexical and semantic
similarity plus intrinsic quality signals, explains *why* each result matched, and
supports faceted refinement, autocomplete, saved history and local analytics.

It is a **fully client-side, deterministic** implementation: no network round-trip,
no external embedding API, no new dependencies. This keeps responses sub-second and
lets the feature work offline against a bundled sample set.

---

## Overview

| Capability | Description |
| --- | --- |
| **Natural-language parsing** | Turns questions into structured filters — commodities, regions/countries, numeric comparisons, risk, status, ESG, dates, negation and quoted phrases. |
| **Semantic search** | Local vector embeddings (hashed bag-of-n-grams) so "chocolate bean harvest" finds cocoa deals by meaning, not just literal words. |
| **Intelligent ranking** | Weighted fusion of lexical, semantic, filter-confidence, ROI, freshness, funding-progress and optional user-behaviour signals. |
| **Result explanations** | Every ranked deal carries an ordered list of "why this matched" reasons grounded in the parsed query. |
| **Faceted refinement** | Commodity / region / risk / status / ROI / tenor / ESG facets with live counts; AND across groups, OR within a group. |
| **Query suggestions** | Prefix + fuzzy (Levenshtein) autocomplete over vocabulary, natural-language templates and recent queries. |
| **Search history** | localStorage-backed recent + saved queries with de-duplication and caps. |
| **Search analytics** | Popular queries, zero-result queries and p50/p95 latency versus the sub-second target. |
| **Performance** | Content-signature index memoization, hard-filter pre-screening, single-pass scoring; `LATENCY_BUDGET_MS = 1000`. |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Advanced Search (client)                             │
│                                                                              │
│   User types natural-language query                                          │
│        │                                                                     │
│        ▼                                                                     │
│   ┌────────────────────┐        ┌──────────────────────────┐                 │
│   │  suggestions.ts    │◀──────▶│  query-parser.ts         │  parseQuery()   │
│   │  (autocomplete)    │        │  → ParsedQuery (filters, │                 │
│   └────────────────────┘        │    terms, intents)       │                 │
│                                 └────────────┬─────────────┘                 │
│                                              │                               │
│                                              ▼                               │
│   ┌──────────────────────────────────────────────────────────────┐          │
│   │                         engine.ts                            │          │
│   │  parse → getIndex() → pre-screen → score → rank → explain →  │          │
│   │  facets, measures latencyMs per stage                        │          │
│   └───────┬───────────────┬───────────────┬──────────────┬───────┘          │
│           │               │               │              │                   │
│           ▼               ▼               ▼              ▼                   │
│   ┌──────────────┐ ┌──────────────┐ ┌────────────┐ ┌──────────────┐          │
│   │ embeddings.ts│ │  ranking.ts  │ │ explain.ts │ │  facets.ts   │          │
│   │ hashed n-gram│ │ weighted fuse│ │ per-result │ │ build/apply  │          │
│   │ cosine sim   │ │ + diversity  │ │ reasons    │ │ (counts)     │          │
│   └──────────────┘ └──────────────┘ └────────────┘ └──────────────┘          │
│                                                                              │
│   Side channels (localStorage, SSR-safe):                                   │
│   ┌───────────────────────┐   ┌─────────────────────────┐                    │
│   │ search-history.ts     │   │ search-analytics.ts     │                    │
│   │ recent + saved        │   │ counts + p50/p95 latency│                    │
│   └───────────────────────┘   └─────────────────────────┘                    │
│                                                                              │
│   UI: useAdvancedSearch() hook → AdvancedSearchPanel (Results/Refine/        │
│       History/Analytics tabs) at /search                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Query grammar (parser)

`parseQuery(raw)` is pure and total — it never throws and always returns
`{ rawQuery, terms, exactPhrase, filters, intents }`.

| Construct | Spoken / symbolic forms | Filter produced |
| --- | --- | --- |
| Commodity | `cocoa`, `soybeans`, `cacao`, `cashews` (plurals + aliases normalised) | `commodity: ['cocoa']` |
| Region / continent | `Africa`, `East Africa`, `West Africa`, `Latin America` … (longest-match first) | `region: ['east africa']` |
| Country | `Nigeria`, `Ghana`, `Kenya`, `Ivory Coast`, `Brazil` … | `country: ['nigeria']` |
| Comparison (numeric) | `roi > 15`, `roi greater than 15%`, `returns above 20`, `roi at least 15` | `roiMin` |
| Upper bound | `under 90 days`, `at most $1m`, `roi < 25` | `termDaysMax` / `valueMax` / `roiMax` |
| Magnitudes | `$50,000`, `10k`, `1.5m`, `500 tons` | scaled numeric bounds |
| Tenor | `term at least 90 days`, `under 90 days` | `termDaysMin` / `termDaysMax` |
| Risk | `low risk`, `high-risk`, `risk medium` | `risk: ['Low']` |
| Status | `open`, `funded`, `completed`, `delivered`, `draft`, `failed` | `status: [...]` |
| ESG | `esg over 70`, `sustainability above 80` | `esgMin` |
| Quantity | `at least 1000 tons` | `quantityMin` |
| Date words | `this year`, `last year`, `next year` | `createdAfter` / `createdBefore` |
| Negation | `not coffee`, `exclude cocoa`, `without peanuts` | `excludeCommodity` / `excludeCountry` / `excludeRegion` |
| Exact phrase | `"single origin arabica"` | `exactPhrase` |
| Free text | stop-worded remainder | `terms: [...]` |

Operators are matched by the phrase closest to the number, and the field is
attributed using only the last few tokens before the number — so
`"roi above 15 term under 90"` correctly binds `90` to tenor, not ROI.

Intents (`question`, `compare`, `recommend`, `recency`, `filter`, `browse`) are
derived from cue words and used by the UI, not (yet) to alter weights.

`filtersToHumanReadable(parsed)` renders the "Interpreted as" chips shown under
the search bar, e.g. `Commodity: cocoa`, `Region: africa`, `ROI ≥ 15%`.

Worked example — `"show me cocoa deals in Africa with ROI > 15%"`:

```
{
  rawQuery: "show me cocoa deals in Africa with ROI > 15%",
  terms: [],
  filters: { commodity: ["cocoa"], region: ["africa"], roiMin: 15.001 },
  intents: ["question", "filter"]
}
```

---

## Embedding model (`embeddings.ts`)

Each deal is serialised to a document (`dealToDocument`: commodity, title,
descriptions, country, region, farm location, status, risk, quantity) and embedded
into a **512-dim dense vector** (`EMBEDDING_DIM`):

1. Tokenise the document.
2. Emit features: word unigrams (`w:`), word bigrams (`b:`) and character
   trigrams (`c:`) — the trigrams give fuzzy morphological robustness (e.g.
   "cocoa"/"cacao" share grams).
3. Hash each feature with **FNV-1a** into `EMBEDDING_DIM` buckets (the hashing
   trick — no stored vocabulary).
4. Weight by **sub-linear term frequency** `1 + log(count)`.
5. **L2-normalise**, so cosine similarity reduces to a dot product.

The model is deterministic — identical inputs always yield identical vectors, and
`cosineSimilarity(zero, x) = 0`. Public API: `embedText`, `embedDeal`,
`cosineSimilarity`, `buildIndex`, `searchByEmbedding`, `mostSimilar`.

---

## Ranking model (`ranking.ts`)

`scoreAndRank(index, parsed, options)` blends seven components. Weights are an
exported, tunable constant:

| Component | Weight | Signal |
| --- | --- | --- |
| `lexical` | **0.28** | Fraction of query tokens (from raw text + terms) present in the deal document |
| `semantic` | **0.27** | Cosine similarity between query vector and deal vector |
| `filter` | **0.22** | Fraction of *active* hard filters the deal satisfies |
| `roi` | **0.08** | Expected ROI normalised against a 30% ceiling |
| `freshness` | **0.07** | Exponential decay, half-life `FRESHNESS_HALF_LIFE_DAYS = 180` |
| `funding` | **0.05** | `funded_amount / total_value` progress |
| `behavior` | **0.03** | Optional `(clicks + 3·investments) / 10` per deal id |

Sum ≈ 1.0. After the raw weighted sum, a **result-diversity penalty**
(`DIVERSITY_PENALTY = 0.04`, multiplied by how many deals of the same commodity
were already emitted) is subtracted and results re-sorted, so a query for `cocoa`
does not bury the whole index under one commodity. Each result carries its
`ScoreBreakdown` and its `ExplanationReason[]`.

Explanation reasons (`explain.ts`) are emitted in a fixed order: filter-grounded
matches first (commodity, country, region, ROI, tenor, risk, status, ESG), then
semantic ("Semantically similar to your query (78% match)"), then lexical, then
funding traction, falling back to a broad-match note.

---

## Facets, suggestions, history, analytics

- **Facets** (`facets.ts`): `buildFacets(results)` produces groups (commodity,
  region/country, risk, status, ROI band, tenor band, ESG band) with per-value
  counts. `applyFacets(results, selection)` keeps results that satisfy every
  selected group (AND across groups, OR within a group).
- **Suggestions** (`suggestions.ts`): `getSuggestions(partial, context)` mixes the
  field vocabulary, natural-language templates and recent queries; typed with a
  `kind`; ranked by match strength → frequency → **Levenshtein** distance (a local
  iterative implementation, `levenshtein('kitten','sitting') === 3`).
- **History** (`search-history.ts`): `recordQuery`, `getHistory`, `clearHistory`,
  `saveQuery`, `getSavedQueries`, `deleteSavedQuery`. Versioned JSON keys
  (`agrifi.advanced_search.history.v1`, `.saved.v1`), `HISTORY_CAP = 50`,
  de-duplication of consecutive repeats, and SSR-safe inert behaviour when
  `typeof window === 'undefined'`.
- **Analytics** (`search-analytics.ts`): `logQuery` persists records
  (`ANALYTICS_CAP = 500`); `buildSummary` (pure) aggregates top queries,
  zero-result queries, average/p50/p95 latency and the sub-second success rate;
  `toReport` renders the panel text. `percentile` uses linear interpolation.

---

## Performance

- **Index memoization**: `engine.getIndex(deals)` keys a module-level cache by
  `indexSignature(deals)` — a cheap FNV hash over `id:commodity:status:value:createdAt`.
  Repeated searches against an unchanged deal-set reuse the same embeddings, so a
  second query is sub-linear (no re-embedding).
- **Pre-screening**: hard filters are evaluated first and only matching deal ids are
  scored, shrinking the scoring pass.
- **Single pass**: `scoreAndRank` scores, ranks, diversifies and explains in one sweep.
- Latency is measured with `performance.now()` (with a `Date.now()` fallback) and
  reported per stage in `SearchExecutionStats.latencyMs`. `LATENCY_BUDGET_MS = 1000`
  is asserted by the engine tests to guarantee sub-second responses.

---

## File map

| Path | Responsibility |
| --- | --- |
| `src/lib/advanced-search/types.ts` | Shared types: `SearchFilters`, `ParsedQuery`, `RankedResult`, `Facet`, `ScoreBreakdown`, `SearchExecutionStats`, … |
| `src/lib/advanced-search/query-parser.ts` | `parseQuery`, `filtersToHumanReadable`, vocabularies, deal field accessors |
| `src/lib/advanced-search/embeddings.ts` | Deterministic embedding model, index, cosine search, `mostSimilar` |
| `src/lib/advanced-search/ranking.ts` | `RANKING_WEIGHTS`, `scoreAndRank`, `passesFilters` |
| `src/lib/advanced-search/explain.ts` | `explainResult` reasons |
| `src/lib/advanced-search/facets.ts` | `buildFacets`, `applyFacets`, `facetValuesFor` |
| `src/lib/advanced-search/suggestions.ts` | `getSuggestions`, `levenshtein`, NL templates |
| `src/lib/advanced-search/search-history.ts` | localStorage recent + saved queries |
| `src/lib/advanced-search/search-analytics.ts` | Query analytics, percentiles, report |
| `src/lib/advanced-search/engine.ts` | `runAdvancedSearch` orchestration + index memoization |
| `src/lib/advanced-search/sample-deals.ts` | Offline `Deal[]` fixture |
| `src/hooks/useAdvancedSearch.ts` | Debounced client hook over the engine |
| `src/components/advanced-search/*.tsx` | Search bar, result card, facets, history, analytics, panel |
| `src/app/[locale]/search/page.tsx` | Route page rendering the panel |

---

## Usage

Programmatic:

```ts
import { runAdvancedSearch } from '@/lib/advanced-search/engine';
import { SAMPLE_DEALS } from '@/lib/advanced-search/sample-deals';

const out = runAdvancedSearch(SAMPLE_DEALS, 'cocoa deals in Africa with ROI above 15%');
console.log(out.stats.latencyMs);           // measured, < 1000ms
console.log(out.explanationOfQuery);        // ["Commodity: cocoa", "Region: africa", "ROI ≥ 15%"]
out.results.forEach((r) => console.log(r.deal.id, r.score, r.explanation));
```

In the UI, the hook wires everything together (it falls back to `SAMPLE_DEALS`
with a logged warning when the marketplace API is unreachable):

```tsx
const {
  query, setQuery, results, facets, selectedFacets, toggleFacet,
  suggestions, interpretedAs, stats, zeroResults,
} = useAdvancedSearch();
```

`<AdvancedSearchPanel />` renders the search bar, tabbed Results / Refine /
History / Analytics sections and a "similar deals" affordance driven by
`mostSimilar`.

---

## How to extend / wire a server-side search backend

The client engine is intentionally modular so a server backend can slot in without
touching the UI:

1. **Swap the data source in `useAdvancedSearch`.** Replace the fallback branch with
   a query to `POST /search` returning `{ results, facets, took }`. The hook already
   degrades to sample data on failure.
2. **Reuse the parser contract.** Send the same `ParsedQuery` structure (or the raw
   string) to the server. `parseQuery` is pure, so the server can call an
   equivalent (ideally shared) grammar and keep the "Interpreted as" chips in sync.
3. **Move embeddings to the vector store.** `embedDeal`/`buildIndex` can be
   recomputed server-side (pgvector, OpenSearch neural, etc.). Keep the exported
   weight object as the ranking spec and send back `scoreBreakdown` + `explanation`
   so the card renders identically.
4. **Server-side facets & suggestions.** `buildFacets` and `getSuggestions` mirror
   the aggregation and prefix/fuzzy APIs you would expose; the shapes
   (`Facet`, `SearchSuggestion`) are transport-ready.
5. **Analytics upload.** `search-analytics` already produces `SearchAnalyticsRecord`s;
   forward them to a telemetry endpoint to power zero-result-query dashboards.
6. **Tuning.** All knobs are exported constants (`RANKING_WEIGHTS`, `DIVERSITY_PENALTY`,
   `FRESHNESS_HALF_LIFE_DAYS`, `EMBEDDING_DIM`, `LATENCY_BUDGET_MS`) so they can be
   feature-flagged or A/B tested without code changes.
