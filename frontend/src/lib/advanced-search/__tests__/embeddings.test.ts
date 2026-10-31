import { describe, expect, it } from 'vitest';
import {
  EMBEDDING_DIM,
  embedDeal,
  embedText,
  cosineSimilarity,
  buildIndex,
  searchByEmbedding,
  mostSimilar,
  dealToDocument,
} from '@/lib/advanced-search/embeddings';
import { SAMPLE_DEALS } from '@/lib/advanced-search/sample-deals';

describe('advanced-search semantic embeddings (#1183)', () => {
  it('produces fixed-length, L2-normalised vectors', () => {
    const v = embedDeal(SAMPLE_DEALS[0]);
    expect(v).toHaveLength(EMBEDDING_DIM);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('is deterministic across calls', () => {
    const a = embedDeal(SAMPLE_DEALS[0]);
    const b = embedDeal(SAMPLE_DEALS[0]);
    expect(a).toEqual(b);
    expect(dealToDocument(SAMPLE_DEALS[0])).toBe(dealToDocument(SAMPLE_DEALS[0]));
  });

  it('returns a zero vector for empty text and cosine 0 for empty vectors', () => {
    expect(embedText('')).toEqual(new Array(EMBEDDING_DIM).fill(0));
    expect(cosineSimilarity(embedText(''), embedText('cocoa'))).toBe(0);
  });

  it('scores a document most similar to itself', () => {
    const v = embedDeal(SAMPLE_DEALS[0]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it('ranks similar commodities closer than dissimilar ones', () => {
    const cocoa = SAMPLE_DEALS.find((d) => d.commodity === 'Cocoa')!;
    const otherCocoa = SAMPLE_DEALS.find((d) => d.commodity === 'Cocoa' && d.id !== cocoa.id)!;
    const rice = SAMPLE_DEALS.find((d) => d.commodity === 'Rice')!;
    const cocoaVec = embedDeal(cocoa);
    expect(cosineSimilarity(cocoaVec, embedDeal(otherCocoa))).toBeGreaterThan(
      cosineSimilarity(cocoaVec, embedDeal(rice)),
    );
  });

  it('searchByEmbedding surfaces a matching commodity first', () => {
    const index = buildIndex(SAMPLE_DEALS);
    const hits = searchByEmbedding(index, embedText('cocoa beans west africa'), 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].deal.commodity).toBe('Cocoa');
  });

  it('mostSimilar excludes the source and is sorted descending', () => {
    const index = buildIndex(SAMPLE_DEALS);
    const id = SAMPLE_DEALS[0].id;
    const similar = mostSimilar(index, id, 3);
    expect(similar).toHaveLength(3);
    expect(similar.every((s) => s.id !== id)).toBe(true);
    expect(similar[0].score).toBeGreaterThanOrEqual(similar[1].score);
  });
});
