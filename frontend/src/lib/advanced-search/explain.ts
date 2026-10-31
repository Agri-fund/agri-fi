import type { Deal } from '@/lib/api';
import type { ExplanationReason, ParsedQuery, ScoreBreakdown } from './types';
import { normalizeCommodity, roiPercent, termDays, esgScore } from './query-parser';

function pct(n: number): string {
  return `${Math.round(n * 10) / 10}%`;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Explain, deterministically, WHY a deal matched a parsed query. Reasons are
 * ordered: explicit filter matches first (the strongest signals), then semantic
 * and lexical similarity, then general quality signals.
 */
export function explainResult(
  deal: Deal,
  parsed: ParsedQuery,
  breakdown: ScoreBreakdown,
): ExplanationReason[] {
  const reasons: ExplanationReason[] = [];
  const f = parsed.filters;
  const dealCommodity = normalizeCommodity(deal.commodity ?? '');

  if (f.commodity?.includes(dealCommodity)) {
    reasons.push({
      reason: `Commodity matches '${dealCommodity}'`,
      field: 'commodity',
      evidence: deal.commodity,
    });
  }

  if (f.country?.length) {
    const hit = deal.country ? normalizeCommodity(deal.country) : '';
    const matched = f.country.find((c) => deal.country?.toLowerCase().includes(c) || c === hit);
    if (matched) {
      reasons.push({
        reason: `Location matches '${matched}'`,
        field: 'country',
        evidence: deal.country ?? matched,
      });
    }
  }

  if (f.region?.length) {
    const blob = `${deal.region ?? ''} ${deal.country ?? ''} ${deal.farm_location ?? ''}`.toLowerCase();
    const matched = f.region.find((r) => blob.includes(r));
    if (matched) {
      reasons.push({
        reason: `Region matches '${matched}'`,
        field: 'region',
        evidence: deal.region ?? deal.farm_location ?? matched,
      });
    }
  }

  const roi = roiPercent(deal);
  if (roi != null && f.roiMin != null && roi >= f.roiMin - 0.002) {
    reasons.push({
      reason: `Expected ROI ${pct(roi)} meets your ${pct(f.roiMin)} minimum`,
      field: 'roi',
      evidence: String(Math.round(roi * 10) / 10),
    });
  } else if (roi != null && f.roiMax != null && roi <= f.roiMax + 0.002) {
    reasons.push({
      reason: `Expected ROI ${pct(roi)} is under your ${pct(f.roiMax)} ceiling`,
      field: 'roi',
      evidence: String(Math.round(roi * 10) / 10),
    });
  }

  const term = termDays(deal);
  if (term != null && f.termDaysMax != null && term <= f.termDaysMax) {
    reasons.push({
      reason: `Tenor ${term} days is within your ${f.termDaysMax}-day limit`,
      field: 'term_days',
      evidence: String(term),
    });
  } else if (term != null && f.termDaysMin != null && term >= f.termDaysMin) {
    reasons.push({
      reason: `Tenor ${term} days is at least your ${f.termDaysMin}-day minimum`,
      field: 'term_days',
      evidence: String(term),
    });
  }

  if (f.risk?.length && deal.risk_rating && f.risk.includes(deal.risk_rating)) {
    reasons.push({
      reason: `Risk rating is ${deal.risk_rating}`,
      field: 'risk_rating',
      evidence: deal.risk_rating,
    });
  }

  if (f.status?.length && f.status.includes(deal.status)) {
    reasons.push({
      reason: `Status is ${titleCase(deal.status)}`,
      field: 'status',
      evidence: deal.status,
    });
  }

  const esg = esgScore(deal);
  if (esg != null && f.esgMin != null && esg >= f.esgMin - 0.002) {
    reasons.push({
      reason: `ESG score ${Math.round(esg)} exceeds your ${Math.round(f.esgMin)} minimum`,
      field: 'esg_score',
      evidence: String(Math.round(esg)),
    });
  }

  if (breakdown.semantic >= 0.2) {
    reasons.push({
      reason: `Semantically similar to your query (${Math.round(breakdown.semantic * 100)}% match)`,
      field: 'semantic',
      evidence: breakdown.semantic.toFixed(3),
    });
  }

  if (breakdown.lexical >= 0.2) {
    const overlap = matchTerms(deal, parsed.terms);
    reasons.push({
      reason: `Text matches your terms${overlap.length ? ` (${overlap.join(', ')})` : ''}`,
      field: 'text',
      evidence: parsed.terms.join(' ') || deal.commodity,
    });
  }

  if (breakdown.funding >= 0.6) {
    reasons.push({
      reason: `Strong funding traction (${Math.round(breakdown.funding * 100)}% funded)`,
      field: 'funding',
      evidence: deal.funded_amount
        ? `${deal.funded_amount}/${deal.total_value}`
        : String(breakdown.funding),
    });
  }

  if (reasons.length === 0) {
    reasons.push({
      reason: 'Broad match — no explicit criteria were satisfied',
      field: 'overall',
      evidence: parsed.rawQuery,
    });
  }

  return reasons;
}

function matchTerms(deal: Deal, terms: string[]): string[] {
  const hay = `${deal.commodity} ${deal.title ?? ''} ${deal.short_description ?? ''} ${
    deal.long_description ?? ''
  } ${deal.farm_location ?? ''}`.toLowerCase();
  return terms.filter((t) => hay.includes(t));
}
