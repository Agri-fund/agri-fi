import { describe, expect, it } from 'vitest';
import { parseQuery, filtersToHumanReadable } from '@/lib/advanced-search/query-parser';

describe('advanced-search query parser (#1183)', () => {
  it('parses a full natural-language question into commodity, region and ROI filters', () => {
    const parsed = parseQuery('show me cocoa deals in Africa with ROI > 15%');
    expect(parsed.filters.commodity).toContain('cocoa');
    expect(parsed.filters.region).toContain('africa');
    expect(parsed.filters.roiMin).toBeGreaterThan(15);
    expect(parsed.intents).toContain('question');
    expect(parsed.intents).toContain('filter');
  });

  it('handles plural commodities and aliases', () => {
    expect(parseQuery('soybeans in India').filters.commodity).toContain('soybean');
    expect(parseQuery('cashews').filters.commodity).toContain('cashew');
    expect(parseQuery('cacao lots').filters.commodity).toContain('cocoa');
  });

  it('prefers the longer region phrase over its substring', () => {
    const parsed = parseQuery('coffee in East Africa');
    expect(parsed.filters.region).toContain('east africa');
    expect(parsed.filters.region).not.toContain('africa');
  });

  it('maps countries to country filters', () => {
    expect(parseQuery('maize from Nigeria').filters.country).toContain('nigeria');
  });

  it('reads word-form operators', () => {
    expect(parseQuery('roi greater than 20 percent').filters.roiMin).toBeGreaterThan(20);
    expect(parseQuery('returns above 15').filters.roiMin).toBeGreaterThan(15);
    expect(parseQuery('term at least 90 days').filters.termDaysMin).toBe(90);
    expect(parseQuery('esg over 70').filters.esgMin).toBeGreaterThan(70);
  });

  it('reads symbol operators and word limits', () => {
    expect(parseQuery('roi >= 15').filters.roiMin).toBe(15);
    expect(parseQuery('under 90 days').filters.termDaysMax).toBe(90);
    expect(parseQuery('at least 1000 tons').filters.quantityMin).toBe(1000);
  });

  it('scales currency, thousands and millions magnitudes', () => {
    expect(parseQuery('minimum $50,000').filters.valueMin).toBe(50000);
    expect(parseQuery('investments of at least 10k').filters.valueMin).toBe(10000);
    expect(parseQuery('over $1.5m').filters.valueMin).toBeCloseTo(1500000, 0);
  });

  it('detects risk, status and date words', () => {
    expect(parseQuery('low risk sesame deals').filters.risk).toContain('Low');
    expect(parseQuery('funded deals in Brazil').filters.status).toContain('funded');
    expect(parseQuery('cocoa this year').filters.createdAfter).toBeTypeOf('string');
  });

  it('handles negation via exclusion lists', () => {
    const parsed = parseQuery('show cocoa deals without coffee');
    expect(parsed.filters.commodity).toContain('cocoa');
    expect(parsed.filters.excludeCommodity).toContain('coffee');
  });

  it('extracts quoted exact phrases', () => {
    const parsed = parseQuery('deals titled "single origin arabica"');
    expect(parsed.exactPhrase).toBe('single origin arabica');
    expect(parsed.terms).not.toContain('origin');
  });

  it('strips stopwords into free-text terms', () => {
    const parsed = parseQuery('organic regenerative lots');
    expect(parsed.terms).toEqual(expect.arrayContaining(['organic', 'regenerative', 'lots']));
  });

  it('is total: never throws on odd input and handles empty / whitespace', () => {
    expect(parseQuery('').filters).toEqual({});
    expect(parseQuery('   ').terms).toEqual([]);
    expect(parseQuery('').intents).toEqual(['browse']);
    expect(() => parseQuery('roi > > > %%%')).not.toThrow();
    expect(() => parseQuery('$ $ $ 999999999')).not.toThrow();
    expect(parseQuery('roi').filters.roiMin).toBeUndefined();
  });

  it('renders human-readable "understood as" chips', () => {
    const chips = filtersToHumanReadable(parseQuery('cocoa deals in Africa with ROI > 15%'));
    expect(chips.some((c) => c.startsWith('Commodity: cocoa'))).toBe(true);
    expect(chips.some((c) => c.includes('ROI ≥ 15%'))).toBe(true);
    expect(chips.some((c) => c.toLowerCase().includes('africa'))).toBe(true);
  });
});
