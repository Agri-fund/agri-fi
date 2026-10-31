import { describe, expect, it } from 'vitest';
import {
  RANKING_WEIGHTS,
  DIVERSITY_PENALTY,
  scoreAndRank,
  passesFilters,
} from '@/lib/advanced-search/ranking';
import { buildIndex } from '@/lib/advanced-search/embeddings';
import { buildFacets, applyFacets, facetValuesFor } from '@/lib/advanced-search/facets';
import { explainResult } from '@/lib/advanced-search/explain';
import { parseQuery } from '@/lib/advanced-search/query-parser';
import { SAMPLE_DEALS } from '@/lib/advanced-search/sample-deals';
import type { ScoreBreakdown } from '@/lib/advanced-search/types';

const NOW = Date.UTC(2026, 9, 25);
const index = buildIndex(SAMPLE_DEALS);

describe('advanced-search ranking (#1183)', () => {
  it('exposes tunable weights that sum to ~1', () => {
    const sum = Object.values(RANKING_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 2);
  });

  it('ranks matching deals first and populates the breakdown', () => {
    const parsed = parseQuery('cocoa');
    const ranked = scoreAndRank(index, parsed, { now: NOW });
    expect(ranked.length).toBe(SAMPLE_DEALS.length);
    expect(ranked[0].deal.commodity).toBe('Cocoa');
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
    const b = ranked[0].scoreBreakdown;
    expect(b.semantic).toBeGreaterThanOrEqual(0);
    expect(b.lexical).toBeGreaterThan(0);
  });

  it('applies a diversity penalty to repeated commodities', () => {
    const parsed = parseQuery('cocoa deals');
    const ranked = scoreAndRank(index, parsed, { now: NOW });
    const cocoa = ranked.filter((r) => r.deal.commodity === 'Cocoa');
    const penalized = cocoa.filter((r) => r.scoreBreakdown.diversityPenalty > 0);
    expect(penalized.length).toBeGreaterThan(0);
    expect(penalized[0].scoreBreakdown.diversityPenalty).toBeCloseTo(DIVERSITY_PENALTY, 3);
  });

  it('honours candidate restriction and behaviour weighting', () => {
    const parsed = parseQuery('deals');
    const restrict = [SAMPLE_DEALS[0].id];
    const ranked = scoreAndRank(index, parsed, { now: NOW, candidateIds: restrict });
    expect(ranked.every((r) => r.deal.id === SAMPLE_DEALS[0].id)).toBe(true);

    const base = scoreAndRank(index, parsed, { now: NOW }).find((r) => r.deal.id === SAMPLE_DEALS[1].id)!;
    const boosted = scoreAndRank(index, parsed, {
      now: NOW,
      behavior: { [SAMPLE_DEALS[1].id]: { clicks: 8, investments: 2 } },
    }).find((r) => r.deal.id === SAMPLE_DEALS[1].id)!;
    expect(boosted.scoreBreakdown.behavior).toBeGreaterThan(base.scoreBreakdown.behavior);
  });
});

describe('advanced-search filter pre-screen (#1183)', () => {
  it('passesFilters enforces hard constraints', () => {
    const cocoaOnly = parseQuery('cocoa').filters;
    const matches = SAMPLE_DEALS.filter((d) => passesFilters(d, cocoaOnly));
    expect(matches.every((d) => d.commodity === 'Cocoa')).toBe(true);

    const roi = parseQuery('cocoa with roi above 15%').filters;
    expect(SAMPLE_DEALS.filter((d) => passesFilters(d, roi)).every((d) => d.commodity === 'Cocoa')).toBe(true);

    expect(passesFilters(SAMPLE_DEALS[0], parseQuery('nonsense').filters)).toBe(true);
  });
});

describe('advanced-search explanation (#1183)', () => {
  it('lists deterministic, filter-grounded reasons', () => {
    const parsed = parseQuery('cocoa in Africa roi above 15%');
    const deal = SAMPLE_DEALS.find((d) => d.id === 'deal-cocoa-gh-01')!;
    const breakdown: ScoreBreakdown = {
      lexical: 0.5,
      semantic: 0.62,
      filter: 1,
      freshness: 0.5,
      funding: 0.75,
      roi: 0.6,
      behavior: 0,
      diversityPenalty: 0,
      total: 0.6,
    };
    const reasons = explainResult(deal, parsed, breakdown).map((r) => r.reason);
    expect(reasons.some((r) => /Commodity matches 'cocoa'/.test(r))).toBe(true);
    expect(reasons.some((r) => /Region matches/.test(r))).toBe(true);
    expect(reasons.some((r) => /Expected ROI/.test(r))).toBe(true);
    expect(reasons.some((r) => /Semantically similar/.test(r))).toBe(true);
  });

  it('falls back to a broad-match reason when nothing matches', () => {
    const reasons = explainResult(
      SAMPLE_DEALS[0],
      parseQuery('zzz'),
      { lexical: 0, semantic: 0, filter: 0, freshness: 0, funding: 0, roi: 0, behavior: 0, diversityPenalty: 0, total: 0 },
    );
    expect(reasons[0].field).toBe('overall');
  });
});

describe('advanced-search facets (#1183)', () => {
  it('builds facet groups with per-value counts', () => {
    const parsed = parseQuery('deals');
    const ranked = scoreAndRank(index, parsed, { now: NOW });
    const facets = buildFacets(ranked);
    const commodity = facets.find((f) => f.id === 'commodity')!;
    expect(commodity.values.find((v) => v.value === 'cocoa')?.count).toBe(2);
    expect(facets.map((f) => f.id)).toEqual(
      expect.arrayContaining(['region', 'risk', 'status', 'roi', 'tenor', 'esg']),
    );
  });

  it('applies facets: AND across groups, OR within a group', () => {
    const parsed = parseQuery('deals');
    const ranked = scoreAndRank(index, parsed, { now: NOW });
    const cocoa = applyFacets(ranked, { commodity: ['cocoa'] });
    expect(cocoa).toHaveLength(2);
    const cocoaLowRisk = applyFacets(ranked, { commodity: ['cocoa'], risk: ['Low'] });
    expect(cocoaLowRisk).toHaveLength(0);
    const eitherCommodity = applyFacets(ranked, { commodity: ['cocoa', 'rice'] });
    expect(eitherCommodity.every((r) => ['Cocoa', 'Rice'].includes(r.deal.commodity))).toBe(true);
  });

  it('computes deal facet membership', () => {
    const deal = SAMPLE_DEALS.find((d) => d.id === 'deal-cocoa-gh-01')!;
    expect(facetValuesFor(deal, 'commodity')).toEqual(['cocoa']);
    expect(facetValuesFor(deal, 'region')).toEqual(expect.arrayContaining(['ghana', 'west africa']));
    expect(facetValuesFor(deal, 'roi')).toEqual(['roi:10-20']);
  });
});
