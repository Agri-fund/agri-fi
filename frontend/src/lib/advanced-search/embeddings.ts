import type { Deal } from '@/lib/api';
import type { SemanticVector } from './types';

/**
 * A small, fully client-side embedding model. Documents (a deal's searchable
 * text) are turned into fixed-length dense vectors using hashed bag-of-n-grams:
 * word unigrams + bigrams + character trigrams (for fuzzy morphology). Term
 * counts use sub-linear frequency scaling and the vector is L2-normalised so
 * cosine similarity reduces to a dot product. Deterministic: no randomness, no
 * network — the same input always yields the same vector.
 */

export const EMBEDDING_DIM = 512;

/** FNV-1a string hash → stable 32-bit unsigned integer. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Assemble the searchable document text for a deal. */
export function dealToDocument(deal: Deal): string {
  return [
    deal.commodity,
    deal.title ?? '',
    deal.short_description ?? '',
    deal.long_description ?? '',
    deal.country ?? '',
    deal.region ?? '',
    deal.farm_location ?? '',
    deal.status,
    deal.risk_rating ?? '',
    deal.quantity_unit,
    String(deal.quantity),
  ]
    .join(' ')
    .toLowerCase();
}

function charTrigrams(token: string): string[] {
  const grams: string[] = [];
  const padded = `^${token}$`;
  for (let i = 0; i + 3 <= padded.length; i += 1) {
    grams.push(padded.slice(i, i + 3));
  }
  return grams;
}

/**
 * Hash `feature` into the vector, adding `weight`. Collisions across distinct
 * features into the same bucket are expected (the "hashing trick") and are what
 * keeps the vector fixed-size without a vocabulary.
 */
function addFeature(vec: number[], feature: string, weight: number): void {
  const idx = fnv1a(feature) % EMBEDDING_DIM;
  vec[idx] += weight;
}

/** Build a dense, L2-normalised embedding for arbitrary text. */
export function embedText(text: string): SemanticVector {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  const tokens = tokenize(text ?? '');
  if (tokens.length === 0) return vec;

  const counts = new Map<string, number>();
  const bump = (feature: string) => counts.set(feature, (counts.get(feature) ?? 0) + 1);

  for (let i = 0; i < tokens.length; i += 1) {
    bump(`w:${tokens[i]}`);
    for (const tri of charTrigrams(tokens[i])) bump(`c:${tri}`);
    if (i + 1 < tokens.length) bump(`b:${tokens[i]} ${tokens[i + 1]}`);
  }

  for (const [feature, count] of counts) {
    // Sub-linear term frequency damps repeated-token dominance.
    addFeature(vec, feature, 1 + Math.log(count));
  }

  return l2Normalize(vec);
}

/** L2-normalise a vector in place-safe manner; zero vectors are returned as-is. */
export function l2Normalize(vec: number[]): SemanticVector {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i += 1) sumSq += vec[i] * vec[i];
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

/** Embed a deal using its document text. */
export function embedDeal(deal: Deal): SemanticVector {
  return embedText(dealToDocument(deal));
}

/** Cosine similarity between two vectors (0 when either is a zero vector). */
export function cosineSimilarity(a: SemanticVector, b: SemanticVector): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface IndexedDeal {
  id: string;
  deal: Deal;
  vector: SemanticVector;
}

/** Immutable search index built once per deal-set and reused across queries. */
export interface EmbeddingIndex {
  items: IndexedDeal[];
  byId: Map<string, IndexedDeal>;
  dim: number;
}

export function buildIndex(deals: Deal[]): EmbeddingIndex {
  const items: IndexedDeal[] = deals.map((deal) => ({
    id: deal.id,
    deal,
    vector: embedDeal(deal),
  }));
  const byId = new Map<string, IndexedDeal>();
  for (const item of items) byId.set(item.id, item);
  return { items, byId, dim: EMBEDDING_DIM };
}

export interface SimilarHit {
  id: string;
  deal: Deal;
  score: number;
}

/** Rank all indexed deals by cosine similarity to a query vector. */
export function searchByEmbedding(
  index: EmbeddingIndex,
  queryVector: SemanticVector,
  topK: number,
): SimilarHit[] {
  const scored = index.items.map((item) => ({
    id: item.id,
    deal: item.deal,
    score: cosineSimilarity(queryVector, item.vector),
  }));
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, Math.max(0, topK));
}

/** The deals most similar to a given indexed deal (excluding itself). */
export function mostSimilar(
  index: EmbeddingIndex,
  dealId: string,
  topK: number,
): SimilarHit[] {
  const source = index.byId.get(dealId);
  if (!source) return [];
  const scored = index.items
    .filter((item) => item.id !== dealId)
    .map((item) => ({
      id: item.id,
      deal: item.deal,
      score: cosineSimilarity(source.vector, item.vector),
    }));
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, Math.max(0, topK));
}
