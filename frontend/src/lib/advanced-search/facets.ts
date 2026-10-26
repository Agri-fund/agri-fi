import type { Deal } from '@/lib/api';
import type { Facet, FacetSelection, FacetValue, RankedResult } from './types';
import { normalizeCommodity, roiPercent, termDays, esgScore } from './query-parser';

const ROI_BANDS: Array<{ value: string; label: string; test: (n: number) => boolean }> = [
  { value: 'roi:0-10', label: 'ROI 0-10%', test: (n) => n < 10 },
  { value: 'roi:10-20', label: 'ROI 10-20%', test: (n) => n >= 10 && n < 20 },
  { value: 'roi:20-30', label: 'ROI 20-30%', test: (n) => n >= 20 && n < 30 },
  { value: 'roi:30+', label: 'ROI 30%+', test: (n) => n >= 30 },
];

const TENOR_BANDS: Array<{ value: string; label: string; test: (n: number) => boolean }> = [
  { value: 'tenor:lt30', label: 'Under 30 days', test: (n) => n < 30 },
  { value: 'tenor:30-60', label: '30-60 days', test: (n) => n >= 30 && n < 60 },
  { value: 'tenor:60-90', label: '60-90 days', test: (n) => n >= 60 && n < 90 },
  { value: 'tenor:90-180', label: '90-180 days', test: (n) => n >= 90 && n < 180 },
  { value: 'tenor:180+', label: '180+ days', test: (n) => n >= 180 },
];

const ESG_BANDS: Array<{ value: string; label: string; test: (n: number) => boolean }> = [
  { value: 'esg:lt40', label: 'ESG below 40', test: (n) => n < 40 },
  { value: 'esg:40-60', label: 'ESG 40-60', test: (n) => n >= 40 && n < 60 },
  { value: 'esg:60-80', label: 'ESG 60-80', test: (n) => n >= 60 && n < 80 },
  { value: 'esg:80+', label: 'ESG 80+', test: (n) => n >= 80 },
];

const GROUPS: Array<{ id: string; label: string }> = [
  { id: 'commodity', label: 'Commodity' },
  { id: 'region', label: 'Region / Country' },
  { id: 'risk', label: 'Risk' },
  { id: 'status', label: 'Status' },
  { id: 'roi', label: 'Expected ROI' },
  { id: 'tenor', label: 'Tenor' },
  { id: 'esg', label: 'ESG Score' },
];

/** The facet values a deal belongs to, for one facet group. */
export function facetValuesFor(deal: Deal, groupId: string): string[] {
  switch (groupId) {
    case 'commodity':
      return deal.commodity ? [normalizeCommodity(deal.commodity)] : [];
    case 'region': {
      const out: string[] = [];
      if (deal.country) out.push(deal.country.toLowerCase());
      if (deal.region) out.push(deal.region.toLowerCase());
      return out;
    }
    case 'risk':
      return deal.risk_rating ? [deal.risk_rating] : [];
    case 'status':
      return deal.status ? [deal.status] : [];
    case 'roi': {
      const roi = roiPercent(deal);
      return roi == null ? [] : [ROI_BANDS.find((b) => b.test(roi))?.value].filter(Boolean) as string[];
    }
    case 'tenor': {
      const t = termDays(deal);
      return t == null ? [] : [TENOR_BANDS.find((b) => b.test(t))?.value].filter(Boolean) as string[];
    }
    case 'esg': {
      const e = esgScore(deal);
      return e == null ? [] : [ESG_BANDS.find((b) => b.test(e))?.value].filter(Boolean) as string[];
    }
    default:
      return [];
  }
}

function bandLabel(groupId: string, value: string): string {
  const list = groupId === 'roi' ? ROI_BANDS : groupId === 'tenor' ? TENOR_BANDS : ESG_BANDS;
  return list.find((b) => b.value === value)?.label ?? value;
}

function pretty(value: string): string {
  return value
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Build facet groups (with per-value counts) from a ranked result set. Counts
 * reflect the results passed in, so a facet panel can be rebuilt after narrowing.
 */
export function buildFacets(results: RankedResult[]): Facet[] {
  return GROUPS.map((group) => {
    const counts = new Map<string, number>();
    for (const result of results) {
      for (const value of facetValuesFor(result.deal, group.id)) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    const values: FacetValue[] = [...counts.entries()]
      .map(([value, count]) => ({
        value,
        count,
        label: ['roi', 'tenor', 'esg'].includes(group.id) ? bandLabel(group.id, value) : pretty(value),
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return { id: group.id, label: group.label, values };
  }).filter((facet) => facet.values.length > 0);
}

/**
 * Apply a facet selection to results: OR within a group, AND across groups.
 * Empty selections for a group are ignored.
 */
export function applyFacets(results: RankedResult[], selection: FacetSelection): RankedResult[] {
  const activeGroups = Object.entries(selection).filter(([, values]) => values && values.length > 0);
  if (activeGroups.length === 0) return results;

  return results.filter((result) =>
    activeGroups.every(([groupId, values]) => {
      const dealValues = facetValuesFor(result.deal, groupId);
      return values.some((v) => dealValues.includes(v));
    }),
  );
}
