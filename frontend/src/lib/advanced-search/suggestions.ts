import type { SearchSuggestion, SuggestionKind } from './types';
import { COMMODITIES, REGIONS, COUNTRIES } from './query-parser';

/** Natural-language example queries surfaced as autocomplete templates. */
export const NL_TEMPLATES: string[] = [
  'cocoa deals in West Africa with ROI above 15%',
  'coffee investments in East Africa under 90 days',
  'low risk sesame deals in Africa',
  'show me funded deals in Brazil',
  'maize deals with ROI greater than 20%',
  'high ESG cashew deals in Vietnam',
  'completed deals in India with returns above 10%',
  'soybean investments over $100k in Latin America',
];

const FIELD_SUGGESTIONS: string[] = [
  'with ROI above 15%',
  'with ROI greater than 20%',
  'under 90 days',
  'in West Africa',
  'in East Africa',
  'low risk',
  'medium risk',
  'high ESG',
  'over $50,000',
  'status open',
];

export interface SuggestionContext {
  /** Previously typed queries (e.g. from search history) surfaced as recents. */
  recentQueries?: string[];
  /** Frequency of past queries, used to rank suggestions by popularity. */
  frequency?: Record<string, number>;
}

/** Classic iterative Levenshtein edit distance. */
export function levenshtein(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  if (s === t) return 0;
  if (s.length === 0) return t.length;
  if (t.length === 0) return s.length;

  let prev = new Array<number>(t.length + 1);
  let curr = new Array<number>(t.length + 1);
  for (let j = 0; j <= t.length; j += 1) prev[j] = j;

  for (let i = 1; i <= s.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[t.length];
}

function vocabulary(): Array<{ text: string; kind: SuggestionKind }> {
  return [
    ...COMMODITIES.map((text) => ({ text, kind: 'commodity' as const })),
    ...REGIONS.map((text) => ({ text, kind: 'region' as const })),
    ...COUNTRIES.map((text) => ({ text, kind: 'region' as const })),
    ...NL_TEMPLATES.map((text) => ({ text, kind: 'template' as const })),
    ...FIELD_SUGGESTIONS.map((text) => ({ text, kind: 'field' as const })),
  ];
}

// Prefix hits beat substring hits beat fuzzy (small edit distance) hits.
function matchStrength(partial: string, candidate: string): number | null {
  const c = candidate.toLowerCase();
  if (c.startsWith(partial)) return 3;
  if (c.includes(partial)) return 2;
  const distance = levenshtein(partial, c);
  const threshold = Math.max(2, Math.ceil(partial.length / 2));
  if (distance <= threshold) return 1;
  return null;
}

/**
 * Autocomplete for partial input, combining the field vocabulary, natural-
 * language templates and recent queries. Ranked by match strength, then query
 * frequency, then edit distance.
 */
export function getSuggestions(
  partial: string,
  context: SuggestionContext = {},
  limit = 8,
): SearchSuggestion[] {
  const trimmed = (partial ?? '').toLowerCase().trim();
  const results: SearchSuggestion[] = [];
  const seen = new Set<string>();
  const freq = context.frequency ?? {};

  const add = (text: string, kind: SuggestionKind, strength: number) => {
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const frequency = freq[key] ?? 0;
    const distance = trimmed ? levenshtein(trimmed, key) : 0;
    const score = strength * 100 + frequency * 5 - distance;
    results.push({ text, kind, score });
  };

  if (trimmed.length === 0) {
    for (const template of NL_TEMPLATES.slice(0, limit)) add(template, 'template', 1);
    for (const recent of context.recentQueries ?? []) add(recent, 'recent', 2);
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  for (const entry of vocabulary()) {
    const strength = matchStrength(trimmed, entry.text);
    if (strength) add(entry.text, entry.kind, strength);
  }
  for (const recent of context.recentQueries ?? []) {
    if (recent.toLowerCase().includes(trimmed)) add(recent, 'recent', 2);
  }

  return results
    .sort(
      (a, b) =>
        b.score - a.score ||
        levenshtein(trimmed, a.text.toLowerCase()) - levenshtein(trimmed, b.text.toLowerCase()) ||
        a.text.localeCompare(b.text),
    )
    .slice(0, limit);
}
