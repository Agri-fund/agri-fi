import { describe, expect, it, beforeEach } from 'vitest';
import {
  runAdvancedSearch,
  getIndex,
  resetIndexCache,
  indexSignature,
  similarDealsTo,
  LATENCY_BUDGET_MS,
  DEFAULT_TOP_K,
} from '@/lib/advanced-search/engine';
import { SAMPLE_DEALS } from '@/lib/advanced-search/sample-deals';

const NOW = Date.UTC(2026, 9, 25);

describe('advanced-search engine (#1183)', () => {
  beforeEach(() => resetIndexCache());

  it('exports a sub-second latency budget', () => {
    expect(LATENCY_BUDGET_MS).toBe(1000);
    expect(DEFAULT_TOP_K).toBeGreaterThan(0);
  });

  it('runs the full pipeline and stays under the latency budget', () => {
    const out = runAdvancedSearch(SAMPLE_DEALS, 'cocoa deals in Africa with ROI above 15%', { now: NOW });
    expect(out.parsed.filters.commodity).toContain('cocoa');
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.results.every((r) => r.deal.commodity === 'Cocoa')).toBe(true);
    expect(out.stats.latencyMs).toBeLessThan(LATENCY_BUDGET_MS);
    expect(out.stats.indexSize).toBe(SAMPLE_DEALS.length);
    expect(out.stats.resultCount).toBe(out.results.length);
    expect(out.explanationOfQuery.length).toBeGreaterThan(0);
    expect(out.results[0].explanation.length).toBeGreaterThan(0);
  });

  it('reports zero results for an impossible query', () => {
    const out = runAdvancedSearch(SAMPLE_DEALS, 'cocoa deals in Brazil', { now: NOW });
    expect(out.results).toHaveLength(0);
    expect(out.stats.resultCount).toBe(0);
  });

  it('returns all deals for an empty query', () => {
    const out = runAdvancedSearch(SAMPLE_DEALS, '', { now: NOW });
    expect(out.results.length).toBe(SAMPLE_DEALS.length);
  });

  it('narrows results when facets are selected', () => {
    const broad = runAdvancedSearch(SAMPLE_DEALS, 'africa', { now: NOW });
    const refined = runAdvancedSearch(SAMPLE_DEALS, 'africa', {
      now: NOW,
      selectedFacets: { commodity: ['cocoa'] },
    });
    expect(refined.results.length).toBeLessThan(broad.results.length);
    expect(refined.results.every((r) => r.deal.commodity === 'Cocoa')).toBe(true);
  });

  it('memoizes the index by content signature', () => {
    const i1 = getIndex(SAMPLE_DEALS);
    const i2 = getIndex(SAMPLE_DEALS);
    expect(i1).toBe(i2);
    expect(indexSignature(SAMPLE_DEALS)).toBe(indexSignature(SAMPLE_DEALS));
    resetIndexCache();
    expect(getIndex(SAMPLE_DEALS)).not.toBe(i1);
  });

  it('respects topK', () => {
    const out = runAdvancedSearch(SAMPLE_DEALS, '', { now: NOW, topK: 3 });
    expect(out.results).toHaveLength(3);
  });

  it('computes similar deals through the shared index', () => {
    const similar = similarDealsTo(SAMPLE_DEALS, 'deal-cocoa-gh-01', 3);
    expect(similar).toHaveLength(3);
    expect(similar.every((s) => s.id !== 'deal-cocoa-gh-01')).toBe(true);
  });
});
