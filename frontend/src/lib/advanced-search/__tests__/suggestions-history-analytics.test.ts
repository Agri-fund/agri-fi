import { describe, expect, it, beforeEach } from 'vitest';
import { getSuggestions, levenshtein, NL_TEMPLATES } from '@/lib/advanced-search/suggestions';
import {
  recordQuery,
  getHistory,
  clearHistory,
  saveQuery,
  getSavedQueries,
  deleteSavedQuery,
  HISTORY_CAP,
} from '@/lib/advanced-search/search-history';
import {
  buildSummary,
  percentile,
  logQuery,
  getAnalytics,
  resetAnalytics,
  toReport,
  SUB_SECOND_TARGET_MS,
} from '@/lib/advanced-search/search-analytics';
import type { SearchAnalyticsRecord } from '@/lib/advanced-search/types';

describe('advanced-search suggestions (#1183)', () => {
  it('computes classic Levenshtein distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('coffee', 'coffee')).toBe(0);
    expect(levenshtein('', 'abc')).toBe(3);
  });

  it('returns prefix-matching commodities', () => {
    const out = getSuggestions('coc');
    expect(out.some((s) => s.text === 'cocoa' && s.kind === 'commodity')).toBe(true);
  });

  it('fuzzy-matches misspelled commodities', () => {
    const out = getSuggestions('cofee');
    expect(out.some((s) => s.text === 'coffee')).toBe(true);
  });

  it('surfaces natural-language templates on empty input', () => {
    const out = getSuggestions('');
    expect(out.every((s) => NL_TEMPLATES.includes(s.text))).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });

  it('includes recent queries from context', () => {
    const out = getSuggestions('cashew', { recentQueries: ['cashew deals in asia'] });
    expect(out.some((s) => s.kind === 'recent')).toBe(true);
  });

  it('ranks by frequency when provided', () => {
    const out = getSuggestions('co', { frequency: { coffee: 10, cocoa: 1 } });
    const coffee = out.findIndex((s) => s.text === 'coffee');
    const cocoa = out.findIndex((s) => s.text === 'cocoa');
    expect(coffee).toBeLessThan(cocoa);
  });

  it('respects the limit', () => {
    expect(getSuggestions('c', {}, 3)).toHaveLength(3);
  });
});

describe('advanced-search history (#1183)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('records queries and dedupes consecutive repeats', () => {
    recordQuery('cocoa', { resultCount: 2, latencyMs: 10 });
    recordQuery('cocoa', { resultCount: 2, latencyMs: 11 });
    const h = getHistory();
    expect(h).toHaveLength(1);
    expect(h[0].count).toBe(2);
    recordQuery('coffee', { resultCount: 1, latencyMs: 5 });
    expect(getHistory()[0].raw).toBe('coffee');
    expect(getHistory()).toHaveLength(2);
  });

  it('ignores empty queries', () => {
    recordQuery('   ');
    expect(getHistory()).toHaveLength(0);
  });

  it('caps history length', () => {
    for (let i = 0; i < HISTORY_CAP + 20; i += 1) recordQuery(`query ${i}`, { resultCount: i % 3, latencyMs: i });
    expect(getHistory()).toHaveLength(HISTORY_CAP);
  });

  it('clears history', () => {
    recordQuery('a');
    clearHistory();
    expect(getHistory()).toHaveLength(0);
  });

  it('saves and deletes saved queries without duplicates', () => {
    saveQuery('best cocoa');
    saveQuery('best cocoa');
    expect(getSavedQueries()).toHaveLength(1);
    saveQuery('coffee under 90 days');
    expect(getSavedQueries()).toHaveLength(2);
    const id = getSavedQueries()[0].id;
    deleteSavedQuery(id);
    expect(getSavedQueries().find((s) => s.id === id)).toBeUndefined();
  });
});

describe('advanced-search analytics (#1183)', () => {
  const records: SearchAnalyticsRecord[] = [
    { raw: 'cocoa', resultCount: 2, latencyMs: 40, at: 1 },
    { raw: 'cocoa', resultCount: 2, latencyMs: 60, at: 2 },
    { raw: 'zzzunknown', resultCount: 0, latencyMs: 1200, at: 3 },
    { raw: 'coffee', resultCount: 1, latencyMs: 1100, at: 4 },
  ];

  it('computes percentiles', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([], 95)).toBe(0);
    expect(percentile([100], 95)).toBe(100);
  });

  it('aggregates top and zero-result queries and latency', () => {
    const s = buildSummary(records);
    expect(s.totalQueries).toBe(4);
    expect(s.zeroResultQueries).toBe(1);
    expect(s.topQueries[0].value).toBe('cocoa');
    expect(s.topQueries[0].count).toBe(2);
    expect(s.zeroResultQueryList[0].value).toBe('zzzunknown');
    expect(s.p95LatencyMs).toBeGreaterThan(60);
    expect(s.subSecondRate).toBeLessThan(100);
  });

  it('produces a text report referencing the sub-second target', () => {
    const report = toReport(buildSummary(records)).join('\n');
    expect(report).toContain('Total queries: 4');
    expect(report).toContain(`${SUB_SECOND_TARGET_MS}ms`);
  });

  it('logs to storage and reads back', () => {
    resetAnalytics();
    logQuery({ raw: 'maize', resultCount: 1, latencyMs: 30, at: Date.now() });
    expect(getAnalytics().totalQueries).toBe(1);
  });
});
