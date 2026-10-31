import type { Deal } from '@/lib/api';
import type {
  AdvancedSearchOptions,
  ParsedQuery,
  RankedResult,
  ScoreBreakdown,
  SearchFilters,
} from './types';
import {
  cosineSimilarity,
  dealToDocument,
  embedText,
  type EmbeddingIndex,
} from './embeddings';
import { normalizeCommodity, roiPercent, termDays, esgScore } from './query-parser';
import { explainResult } from './explain';

/**
 * Relevance weights. Exported so they are testable and tunable. Lexical and
 * semantic similarity dominate; behavioural signals (clicks / investments) and
 * intrinsic quality (freshness, funding, ROI) act as secondary boosters.
 */
export const RANKING_WEIGHTS = {
  lexical: 0.28,
  semantic: 0.27,
  filter: 0.22,
  roi: 0.08,
  freshness: 0.07,
  funding: 0.05,
  behavior: 0.03,
} as const;

/** Score subtraction per extra deal of the same commodity (result diversity). */
export const DIVERSITY_PENALTY = 0.04;

/** Freshness half-life in days — a deal this old loses ~50% of its freshness score. */
export const FRESHNESS_HALF_LIFE_DAYS = 180;

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function tokenizeDoc(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

/** Active numeric / categorical filter criteria in `filters`. */
export function countActiveFilters(filters: SearchFilters): number {
  let n = 0;
  const arr = (v: unknown) => Array.isArray(v) && v.length > 0;
  if (arr(filters.commodity)) n += 1;
  if (arr(filters.excludeCommodity)) n += 1;
  if (arr(filters.region)) n += 1;
  if (arr(filters.country)) n += 1;
  if (arr(filters.excludeCountry)) n += 1;
  if (arr(filters.excludeRegion)) n += 1;
  if (arr(filters.risk)) n += 1;
  if (arr(filters.status)) n += 1;
  for (const key of [
    'roiMin',
    'roiMax',
    'termDaysMin',
    'termDaysMax',
    'esgMin',
    'esgMax',
    'quantityMin',
    'quantityMax',
    'valueMin',
    'valueMax',
    'createdAfter',
    'createdBefore',
  ] as const) {
    if (filters[key] != null) n += 1;
  }
  return n;
}

/** Does the deal satisfy every active filter (hard constraint)? */
export function passesFilters(deal: Deal, filters: SearchFilters): boolean {
  const commodity = normalizeCommodity(deal.commodity ?? '');
  const country = (deal.country ?? '').toLowerCase();
  const regionBlob = `${deal.region ?? ''} ${deal.country ?? ''} ${deal.farm_location ?? ''}`.toLowerCase();
  const roi = roiPercent(deal);
  const term = termDays(deal);
  const esg = esgScore(deal);

  if (filters.commodity?.length && !filters.commodity.includes(commodity)) return false;
  if (filters.excludeCommodity?.length && filters.excludeCommodity.includes(commodity)) return false;
  if (filters.country?.length && !filters.country.some((c) => country.includes(c))) return false;
  if (filters.excludeCountry?.length && filters.excludeCountry.some((c) => country.includes(c))) return false;
  if (filters.region?.length && !filters.region.some((r) => regionBlob.includes(r))) return false;
  if (filters.excludeRegion?.length && filters.excludeRegion.some((r) => regionBlob.includes(r))) return false;
  if (filters.risk?.length && (!deal.risk_rating || !filters.risk.includes(deal.risk_rating))) return false;
  if (filters.status?.length && !filters.status.includes(deal.status)) return false;

  if (filters.roiMin != null && (roi == null || roi < filters.roiMin - 0.002)) return false;
  if (filters.roiMax != null && (roi == null || roi > filters.roiMax + 0.002)) return false;
  if (filters.termDaysMin != null && (term == null || term < filters.termDaysMin)) return false;
  if (filters.termDaysMax != null && (term == null || term > filters.termDaysMax)) return false;
  if (filters.esgMin != null && (esg == null || esg < filters.esgMin - 0.002)) return false;
  if (filters.esgMax != null && (esg == null || esg > filters.esgMax + 0.002)) return false;
  if (filters.valueMin != null && !(deal.total_value >= filters.valueMin)) return false;
  if (filters.valueMax != null && !(deal.total_value <= filters.valueMax)) return false;
  if (filters.quantityMin != null && !(deal.quantity >= filters.quantityMin)) return false;
  if (filters.quantityMax != null && !(deal.quantity <= filters.quantityMax)) return false;

  if (filters.createdAfter && deal.created_at && new Date(deal.created_at) < new Date(filters.createdAfter)) return false;
  if (filters.createdBefore && deal.created_at && new Date(deal.created_at) >= new Date(filters.createdBefore)) return false;

  return true;
}

/** Fraction of active filters the deal satisfies (0 when there are none). */
function filterConfidence(deal: Deal, filters: SearchFilters): number {
  const checks: boolean[] = [];
  const commodity = normalizeCommodity(deal.commodity ?? '');
  const country = (deal.country ?? '').toLowerCase();
  const regionBlob = `${deal.region ?? ''} ${deal.country ?? ''} ${deal.farm_location ?? ''}`.toLowerCase();
  const roi = roiPercent(deal);
  const term = termDays(deal);
  const esg = esgScore(deal);

  if (filters.commodity?.length) checks.push(filters.commodity.includes(commodity));
  if (filters.excludeCommodity?.length) checks.push(!filters.excludeCommodity.includes(commodity));
  if (filters.region?.length) checks.push(filters.region.some((r) => regionBlob.includes(r)));
  if (filters.country?.length) checks.push(filters.country.some((c) => country.includes(c)));
  if (filters.excludeCountry?.length) checks.push(!filters.excludeCountry.some((c) => country.includes(c)));
  if (filters.risk?.length) checks.push(!!deal.risk_rating && filters.risk.includes(deal.risk_rating));
  if (filters.status?.length) checks.push(filters.status.includes(deal.status));
  if (filters.roiMin != null) checks.push(roi != null && roi >= filters.roiMin - 0.002);
  if (filters.roiMax != null) checks.push(roi != null && roi <= filters.roiMax + 0.002);
  if (filters.termDaysMin != null) checks.push(term != null && term >= filters.termDaysMin);
  if (filters.termDaysMax != null) checks.push(term != null && term <= filters.termDaysMax);
  if (filters.esgMin != null) checks.push(esg != null && esg >= filters.esgMin - 0.002);
  if (filters.esgMax != null) checks.push(esg != null && esg <= filters.esgMax + 0.002);
  if (filters.valueMin != null) checks.push(deal.total_value >= filters.valueMin);
  if (filters.valueMax != null) checks.push(deal.total_value <= filters.valueMax);
  if (filters.quantityMin != null) checks.push(deal.quantity >= filters.quantityMin);
  if (filters.quantityMax != null) checks.push(deal.quantity <= filters.quantityMax);

  if (checks.length === 0) return 0;
  const satisfied = checks.reduce((acc, ok) => acc + (ok ? 1 : 0), 0);
  return clamp01(satisfied / checks.length);
}

function queryTokens(parsed: ParsedQuery): string[] {
  const set = new Set<string>();
  for (const source of [parsed.rawQuery, ...(parsed.terms ?? [])]) {
    for (const token of tokenizeDoc(String(source ?? ''))) {
      if (token.length > 2) set.add(token);
    }
  }
  return [...set];
}

function lexicalScore(parsed: ParsedQuery, doc: string): number {
  const qt = queryTokens(parsed);
  let hits = 0;
  for (const t of qt) if (doc.includes(t)) hits += 1;
  let score = qt.length ? hits / qt.length : 0;
  if (parsed.exactPhrase) {
    score = doc.toLowerCase().includes(parsed.exactPhrase.toLowerCase()) ? 1 : score;
  }
  return clamp01(score);
}

function freshnessScore(deal: Deal, now: number): number {
  if (!deal.created_at) return 0;
  const created = new Date(deal.created_at).getTime();
  if (Number.isNaN(created)) return 0;
  const days = Math.max(0, (now - created) / 86_400_000);
  return clamp01(Math.pow(0.5, days / FRESHNESS_HALF_LIFE_DAYS));
}

function fundingProgress(deal: Deal): number {
  if (!deal.total_value) return 0;
  return clamp01(deal.funded_amount / deal.total_value);
}

function roiScore(deal: Deal): number {
  const roi = roiPercent(deal);
  if (roi == null) return 0;
  // Normalise against a 30% ceiling — higher ROI saturates.
  return clamp01(roi / 30);
}

function behaviorScore(deal: Deal, options: AdvancedSearchOptions): number {
  const signal = options.behavior?.[deal.id];
  if (!signal) return 0;
  const clicks = signal.clicks ?? 0;
  const investments = signal.investments ?? 0;
  // Investments weighted more heavily than passive clicks; saturate at 10 units.
  return clamp01((clicks + investments * 3) / 10);
}

export interface ScoredEntry {
  deal: Deal;
  breakdown: ScoreBreakdown;
}

/** Compute the weighted breakdown for a single deal (no diversity applied yet). */
export function scoreDeal(
  deal: Deal,
  parsed: ParsedQuery,
  queryVector: number[],
  dealVector: number[],
  doc: string,
  options: AdvancedSearchOptions,
): ScoreBreakdown {
  const w = RANKING_WEIGHTS;
  const lexical = lexicalScore(parsed, doc);
  const semantic = clamp01(cosineSimilarity(queryVector, dealVector));
  const filter = filterConfidence(deal, parsed.filters);
  const freshness = freshnessScore(deal, options.now ?? Date.now());
  const funding = fundingProgress(deal);
  const roi = roiScore(deal);
  const behavior = behaviorScore(deal, options);

  const total =
    w.lexical * lexical +
    w.semantic * semantic +
    w.filter * filter +
    w.roi * roi +
    w.freshness * freshness +
    w.funding * funding +
    w.behavior * behavior;

  return {
    lexical,
    semantic,
    filter,
    freshness,
    funding,
    roi,
    behavior,
    diversityPenalty: 0,
    total,
  };
}

/**
 * Score, diversify and rank every indexed deal (optionally restricted to
 * `options.candidateIds`) against a parsed query. Returns RankedResults sorted
 * by descending score, each carrying its score breakdown and explanation.
 */
export function scoreAndRank(
  index: EmbeddingIndex,
  parsed: ParsedQuery,
  options: AdvancedSearchOptions = {},
): RankedResult[] {
  const queryVector = embedText(`${parsed.rawQuery} ${(parsed.terms ?? []).join(' ')}`);
  const candidateSet = options.candidateIds ? new Set(options.candidateIds) : null;

  const scored: ScoredEntry[] = [];
  for (const item of index.items) {
    if (candidateSet && !candidateSet.has(item.id)) continue;
    const breakdown = scoreDeal(
      item.deal,
      parsed,
      queryVector,
      item.vector,
      dealToDocument(item.deal),
      options,
    );
    scored.push({ deal: item.deal, breakdown });
  }

  // Pre-sort by raw weighted score so the diversity penalty is applied in the
  // order the engine intends to present results.
  scored.sort((a, b) => b.breakdown.total - a.breakdown.total || a.deal.id.localeCompare(b.deal.id));

  const commoditySeen = new Map<string, number>();
  for (const entry of scored) {
    const key = normalizeCommodity(entry.deal.commodity ?? '');
    const repeats = commoditySeen.get(key) ?? 0;
    commoditySeen.set(key, repeats + 1);
    if (repeats > 0) {
      const penalty = DIVERSITY_PENALTY * repeats;
      entry.breakdown.diversityPenalty = penalty;
      entry.breakdown.total = Math.max(0, entry.breakdown.total - penalty);
    }
  }

  scored.sort(
    (a, b) =>
      b.breakdown.total - a.breakdown.total ||
      a.deal.commodity.localeCompare(b.deal.commodity) ||
      a.deal.id.localeCompare(b.deal.id),
  );

  return scored.map((entry) => ({
    deal: entry.deal,
    score: roundScore(entry.breakdown.total),
    scoreBreakdown: entry.breakdown,
    explanation: explainResult(entry.deal, parsed, entry.breakdown),
  }));
}

function roundScore(n: number): number {
  return Math.round(n * 10000) / 10000;
}
