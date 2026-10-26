import type { Deal } from '@/lib/api';
import type { ParsedQuery, SearchFilters, SearchIntent } from './types';

// ── Vocabularies ────────────────────────────────────────────────────────────

/** Canonical commodity names. Plural / alias forms map onto these. */
export const COMMODITIES: string[] = [
  'cocoa',
  'coffee',
  'maize',
  'corn',
  'soybean',
  'cashew',
  'sesame',
  'cotton',
  'groundnut',
  'peanut',
  'wheat',
  'rice',
  'barley',
  'sorghum',
  'millet',
  'sunflower',
  'tea',
  'banana',
  'sugar',
  'palm oil',
  'rubber',
  'tobacco',
  'vanilla',
  'coconut',
];

const COMMODITY_ALIASES: Record<string, string> = {
  coco: 'cocoa',
  cacao: 'cocoa',
  choc: 'cocoa',
  soya: 'soybean',
  sojabean: 'soybean',
  soy: 'soybean',
  palmoil: 'palm oil',
};

/** Continents and sub-regions. Matched before countries so "East Africa" wins over "Africa". */
export const REGIONS: string[] = [
  'africa',
  'east africa',
  'west africa',
  'central africa',
  'southern africa',
  'north africa',
  'asia',
  'southeast asia',
  'south asia',
  'europe',
  'latin america',
  'south america',
  'central america',
  'north america',
  'oceania',
  'middle east',
];

/** Countries commonly listed on AgriFi deals. */
export const COUNTRIES: string[] = [
  'nigeria',
  'ghana',
  'kenya',
  'ivory coast',
  "cote d'ivoire",
  'tanzania',
  'brazil',
  'india',
  'ethiopia',
  'uganda',
  'rwanda',
  'cameroon',
  'mali',
  'senegal',
  'sudan',
  'malawi',
  'zambia',
  'mozambique',
  'vietnam',
  'thailand',
  'indonesia',
  'china',
  'colombia',
  'peru',
  'argentina',
  'mexico',
  'ecuador',
  'ukraine',
  'russia',
  'canada',
];

const COUNTRY_CANON: Record<string, string> = {
  "cote d'ivoire": 'ivory coast',
};

const RISK_WORDS: Record<string, 'Low' | 'Medium' | 'High'> = {
  low: 'Low',
  safe: 'Low',
  medium: 'Medium',
  med: 'Medium',
  moderate: 'Medium',
  high: 'High',
  risky: 'High',
};

const STATUS_WORDS: Deal['status'][] = [
  'draft',
  'open',
  'funded',
  'delivered',
  'completed',
  'failed',
];

// Words that never become free-text terms: stopwords, operators and field names.
const NON_TERMS = new Set<string>([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'with', 'for', 'to', 'from',
  'by', 'at', 'is', 'are', 'be', 'show', 'me', 'deal', 'deals', 'listing',
  'listings', 'investment', 'investments', 'investor', 'investors',
  'opportunity', 'opportunities', 'commodity', 'commodities', 'products',
  'that', 'which', 'who', 'what', 'find', 'get', 'give', 'looking', 'look',
  'search', 'searching', 'want', 'need', 'i', 'we', 'you', 'my', 'your',
  'please', 'can', 'could', 'would', 'should', 'do', 'does', 'about', 'any',
  'some', 'than', 'then', 'there', 'here', 'this', 'these', 'those', 'it',
  'its', 'as', 'so', 'if', 'has', 'have', 'not', 'no', 'without', 'exclude',
  'except', 'avoid', 'greater', 'less', 'above', 'below', 'over', 'under',
  'least', 'most', 'minimum', 'maximum', 'up', 'min', 'max', 'more', 'fewer',
  'higher', 'lower', 'roi', 'returns', 'return', 'yield', 'profit', 'interest',
  'apy', 'apr', 'term', 'tenor', 'duration', 'period', 'maturity', 'days',
  'day', 'value', 'amount', 'size', 'worth', 'usd', 'dollar', 'dollars',
  'ticket', 'budget', 'esg', 'sustainability', 'impact', 'quantity', 'qty',
  'volume', 'risk', 'rating', 'status', 'tonnes', 'tons', 'ton', 'kg', 'score',
  'per', 'year', 'annual', 'expected', 'between', 'range', 'than',
]);

// Longer phrases must be tested before single symbols so "no less than"
// resolves before "less".
const OPERATOR_PHRASES: Array<[RegExp, 'gt' | 'gte' | 'lt' | 'lte']> = [
  [/\bno less than\b/, 'gte'],
  [/\bnot less than\b/, 'gte'],
  [/\bat least\b/, 'gte'],
  [/\bminimum\b/, 'gte'],
  [/\bmin\b/, 'gte'],
  [/\bno more than\b/, 'lte'],
  [/\bnot more than\b/, 'lte'],
  [/\bat most\b/, 'lte'],
  [/\bmaximum\b/, 'lte'],
  [/\bmax\b/, 'lte'],
  [/\bup to\b/, 'lte'],
  [/\bgreater than\b/, 'gt'],
  [/\bmore than\b/, 'gt'],
  [/\bhigher than\b/, 'gt'],
  [/\bless than\b/, 'lt'],
  [/\bfewer than\b/, 'lt'],
  [/\blower than\b/, 'lt'],
  [/>=/, 'gte'],
  [/<=/, 'lte'],
  [/\babove\b/, 'gt'],
  [/\bover\b/, 'gt'],
  [/\bbelow\b/, 'lt'],
  [/\bunder\b/, 'lt'],
  [/>/, 'gt'],
  [/</, 'lt'],
];

// ── Field helper accessors (shared with ranking / explanation) ────────────────

/** Deal expected ROI as a percentage (0-100 scale). */
export function roiPercent(deal: Deal): number | null {
  const expected = deal.expected_roi;
  if (typeof expected === 'number' && !Number.isNaN(expected)) {
    return expected > 1 ? expected : expected * 100;
  }
  const annual = deal.annual_roi;
  if (typeof annual === 'number' && !Number.isNaN(annual)) {
    return annual > 1 ? annual : annual * 100;
  }
  return null;
}

/** Deal tenor in days. */
export function termDays(deal: Deal): number | null {
  const term = deal.term_days;
  if (typeof term === 'number' && !Number.isNaN(term)) return term;
  const duration = deal.duration_days;
  if (typeof duration === 'number' && !Number.isNaN(duration)) return duration;
  return null;
}

/** Deal ESG composite score. */
export function esgScore(deal: Deal): number | null {
  return typeof deal.esg_score === 'number' ? deal.esg_score : null;
}

/** Canonicalise a raw commodity string (trim, lowercase, depluralise, alias). */
export function normalizeCommodity(raw: string): string {
  const base = raw.toLowerCase().trim();
  if (COMMODITY_ALIASES[base]) return COMMODITY_ALIASES[base];
  const single = singularize(base);
  return COMMODITY_ALIASES[single] ?? single;
}

/** Minimal, deterministic singulariser for the small set of commodity forms. */
export function singularize(word: string): string {
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if ((word.endsWith('oes') || word.endsWith('ses')) && word.length > 4) {
    return word.slice(0, -2);
  }
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) {
    return word.slice(0, -1);
  }
  return word;
}

function canonicalCountry(word: string): string {
  return COUNTRY_CANON[word] ?? word;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((t) => t.trim())
    .filter(Boolean);
}

function pushUnique<T>(arr: T[], value: T): void {
  if (!arr.includes(value)) arr.push(value);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Numeric comparison scanning ─────────────────────────────────────────────

interface NumericAtom {
  value: number;
  unit: string | null;
  currency: boolean;
  index: number;
  tail: string; // text after the numeric literal
}

const UNIT_RE =
  /^\s*(%|percent|pct|usd|dollars?|thousand|million|weeks?|months?|days?|tonnes?|tons?|kg|mt)\b/;
const MAGNITUDE_SUFFIX_RE = /^\s*(k|m)(?![a-z])/;
const NUMBER_RE = /(\$\s*)?(\d[\d,]*(?:\.\d+)?)/g;

function findNumbers(text: string): NumericAtom[] {
  const atoms: NumericAtom[] = [];
  NUMBER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NUMBER_RE.exec(text)) !== null) {
    const tail = text.slice(match.index + match[0].length);
    const unitMatch = tail.match(UNIT_RE);
    atoms.push({
      value: Number(match[2].replace(/,/g, '')),
      unit: unitMatch ? unitMatch[1].toLowerCase().replace(/s$/, '') : null,
      currency: Boolean(match[1]),
      index: match.index,
      tail,
    });
  }
  return atoms;
}

// Pick the operator closest to (immediately preceding) the number.
function detectOperator(before: string): 'gt' | 'gte' | 'lt' | 'lte' | null {
  let best: { op: 'gt' | 'gte' | 'lt' | 'lte'; pos: number } | null = null;
  for (const [re, op] of OPERATOR_PHRASES) {
    const m = before.match(re);
    if (m) {
      const pos = (m.index ?? 0) + m[0].length;
      if (!best || pos > best.pos) best = { op, pos };
    }
  }
  return best ? best.op : null;
}

type FieldKind = 'roi' | 'term' | 'value' | 'esg' | 'quantity';

function unitField(unit: string | null, currency: boolean): FieldKind | null {
  if (currency) return 'value';
  if (!unit) return null;
  if (unit === '%' || unit === 'percent' || unit === 'pct') return 'roi';
  if (unit === 'day' || unit === 'week' || unit === 'month') return 'term';
  if (unit === 'usd' || unit === 'dollar' || unit === 'thousand' || unit === 'million') {
    return 'value';
  }
  if (unit === 'ton' || unit === 'tonne' || unit === 'kg' || unit === 'mt') {
    return 'quantity';
  }
  return null;
}

const FIELD_KEYWORDS: Record<FieldKind, RegExp> = {
  roi: /\b(roi|returns?|yield|profit|interest|apy|apr)\b/,
  term: /\b(term|tenor|duration|period|maturity)\b/,
  value: /\b(value|amount|size|worth|usd|dollars?|investments?|funds?|tickets?|budgets?)\b/,
  esg: /\b(esg|sustainability|impact)\b/,
  quantity: /\b(quantity|qty|volume)\b/,
};

function keywordField(before: string): FieldKind | null {
  for (const kind of ['roi', 'term', 'esg', 'quantity', 'value'] as FieldKind[]) {
    if (FIELD_KEYWORDS[kind].test(before)) return kind;
  }
  return null;
}

function scaleValue(value: number, unit: string | null): number {
  if (unit === 'week') return value * 7;
  if (unit === 'month') return value * 30;
  return value;
}

function applyNumericFilter(
  filters: SearchFilters,
  kind: FieldKind,
  op: 'gt' | 'gte' | 'lt' | 'lte',
  value: number,
): void {
  // Strict gt/lt add a sub-unit epsilon so a value exactly equal to the bound
  // is excluded, while gte/lte keep it.
  const lowBound = op === 'lt' ? value - 0.001 : value;
  const highBound = op === 'gt' ? value + 0.001 : value;
  if (kind === 'roi') {
    if (op === 'gt' || op === 'gte') filters.roiMin = highBound;
    else filters.roiMax = lowBound;
  } else if (kind === 'term') {
    const days = Math.round(value);
    if (op === 'gt' || op === 'gte') filters.termDaysMin = days;
    else filters.termDaysMax = days;
  } else if (kind === 'value') {
    if (op === 'gt' || op === 'gte') filters.valueMin = highBound;
    else filters.valueMax = lowBound;
  } else if (kind === 'esg') {
    if (op === 'gt' || op === 'gte') filters.esgMin = highBound;
    else filters.esgMax = lowBound;
  } else if (op === 'gt' || op === 'gte') filters.quantityMin = highBound;
  else filters.quantityMax = lowBound;
}

function extractNumericFilters(text: string): SearchFilters {
  const filters: SearchFilters = {};
  const atoms = findNumbers(text);
  for (let i = 0; i < atoms.length; i += 1) {
    const atom = atoms[i];
    const before = text.slice(0, atom.index);
    // Only the last few words before the number can name the field, so a query
    // like "roi above 15 term under 90" attributes 90 to term, not roi.
    const beforeWindow = tokenize(before).slice(-4).join(' ');

    let value = atom.value;
    const mag = atom.tail.match(MAGNITUDE_SUFFIX_RE);
    if (mag && !atom.unit) {
      value = atom.value * (mag[1] === 'k' ? 1_000 : 1_000_000);
    }

    const op = detectOperator(before);
    const keywordKind = keywordField(beforeWindow);
    const kind = unitField(atom.unit, atom.currency) ?? keywordKind;

    // Register only when the number is disambiguated by an operator, unit,
    // currency symbol or field keyword (so bare years / ids are ignored).
    if (kind && (op || atom.unit || atom.currency || keywordKind)) {
      applyNumericFilter(filters, kind, op ?? 'gte', scaleValue(value, atom.unit));
    }
  }
  return filters;
}

// ── Date-ish words ──────────────────────────────────────────────────────────

function extractDateFilters(text: string): SearchFilters {
  const filters: SearchFilters = {};
  const year = new Date().getFullYear();
  if (/\bthis year\b/.test(text)) {
    filters.createdAfter = new Date(Date.UTC(year, 0, 1)).toISOString();
  } else if (/\blast year\b/.test(text)) {
    filters.createdAfter = new Date(Date.UTC(year - 1, 0, 1)).toISOString();
    filters.createdBefore = new Date(Date.UTC(year, 0, 1)).toISOString();
  } else if (/\bnext year\b/.test(text)) {
    filters.createdBefore = new Date(Date.UTC(year + 2, 0, 1)).toISOString();
  }
  return filters;
}

// ── Entity matching ─────────────────────────────────────────────────────────

const PHRASE_INDEX: Array<{ phrase: string; value: string; kind: 'commodity' | 'region' | 'country' }> = [
  ...COMMODITIES.flatMap((p) => [
    { phrase: p, value: p, kind: 'commodity' as const },
    // Plural form (e.g. "soybeans") maps back to the canonical singular.
    { phrase: `${p}s`, value: p, kind: 'commodity' as const },
  ]),
  ...Object.entries(COMMODITY_ALIASES).map(([phrase, value]) => ({
    phrase,
    value,
    kind: 'commodity' as const,
  })),
  ...REGIONS.map((p) => ({ phrase: p, value: p, kind: 'region' as const })),
  ...COUNTRIES.map((p) => ({ phrase: p, value: canonicalCountry(p), kind: 'country' as const })),
].sort((a, b) => b.phrase.length - a.phrase.length);

function findNegations(text: string): Set<string> {
  const negated = new Set<string>();
  const re = /\b(?:not|exclude|without|avoid|except)\s+([a-z]+(?:\s+[a-z]+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    for (const token of tokenize(m[1])) negated.add(token);
    negated.add(m[1].trim());
  }
  return negated;
}

function matchPhrases(
  text: string,
  negated: Set<string>,
): { filters: SearchFilters; matched: string[] } {
  const filters: SearchFilters = {};
  const matched: string[] = [];
  let working = ` ${text} `;

  for (const entry of PHRASE_INDEX) {
    const re = new RegExp(`\\s${escapeRegex(entry.phrase)}\\s`, 'g');
    if (re.test(working)) {
      working = working.replace(re, ' ');
      matched.push(entry.phrase);
      const isNegated = negated.has(entry.value) || negated.has(entry.phrase);
      if (entry.kind === 'commodity') {
        if (isNegated) pushUnique((filters.excludeCommodity ??= []), entry.value);
        else pushUnique((filters.commodity ??= []), entry.value);
      } else if (entry.kind === 'region') {
        if (isNegated) pushUnique((filters.excludeRegion ??= []), entry.value);
        else pushUnique((filters.region ??= []), entry.value);
      } else {
        if (isNegated) pushUnique((filters.excludeCountry ??= []), entry.value);
        else pushUnique((filters.country ??= []), entry.value);
      }
    }
  }

  for (const [word, rating] of Object.entries(RISK_WORDS)) {
    const re = new RegExp(`\\b(?:${word}[ -]?risk|risk[ -]?${word})\\b`);
    if (re.test(text)) {
      pushUnique((filters.risk ??= []), rating);
      matched.push(`${word} risk`);
    }
  }

  for (const status of STATUS_WORDS) {
    if (new RegExp(`\\b${status}\\b`).test(text)) {
      pushUnique((filters.status ??= []), status);
      matched.push(status);
    }
  }

  return { filters, matched };
}

// ── Intent detection ────────────────────────────────────────────────────────

function detectIntents(text: string, filters: SearchFilters): SearchIntent[] {
  const intents: SearchIntent[] = [];
  if (/\b(compare|versus|vs\.?)\b/.test(text)) intents.push('compare');
  if (/\b(recommend|best|top|suggest|popular|highlight)\b/.test(text)) intents.push('recommend');
  if (/\b(recent|newest|latest)\b/.test(text)) intents.push('recency');
  const hasNumeric = Object.entries(filters).some(
    ([k, v]) => /min|max|created/i.test(k) && v != null,
  );
  if (hasNumeric) intents.push('filter');
  if (/^(what|which|who|how|show|find)\b/.test(text) || text.includes('?')) intents.push('question');
  if (intents.length === 0) intents.push('browse');
  return intents;
}

// ── Main parse ──────────────────────────────────────────────────────────────

/**
 * Parse a natural-language query into structured filters, free-text terms,
 * an optional exact phrase and detected intents. Pure and total: never throws,
 * and returns a well-formed ParsedQuery for any string (including empty).
 */
export function parseQuery(raw: string): ParsedQuery {
  const rawQuery = typeof raw === 'string' ? raw : '';
  if (!rawQuery.trim()) {
    return { rawQuery, terms: [], filters: {}, intents: ['browse'] };
  }

  let text = rawQuery.toLowerCase();

  // Exact phrase from the first quoted span, removed before further parsing.
  let exactPhrase: string | undefined;
  const quoteMatch = text.match(/["“]([^"“]+)["”]/);
  if (quoteMatch) {
    exactPhrase = quoteMatch[1].trim();
    text = text.replace(quoteMatch[0], ' ');
  }

  const negated = findNegations(text);
  const phraseResult = matchPhrases(text, negated);
  const filters = mergeFilters(
    phraseResult.filters,
    extractNumericFilters(text),
    extractDateFilters(text),
  );

  const consumed = new Set<string>([
    ...phraseResult.matched,
    ...(exactPhrase ? tokenize(exactPhrase) : []),
  ]);

  const terms: string[] = [];
  for (const token of tokenize(text)) {
    if (!/[a-z]/.test(token)) continue;
    const single = singularize(token);
    if (NON_TERMS.has(token) || NON_TERMS.has(single)) continue;
    if (consumed.has(token) || consumed.has(single)) continue;
    pushUnique(terms, token);
  }

  const intents = detectIntents(rawQuery.toLowerCase(), filters);
  const parsed: ParsedQuery = { rawQuery, terms, filters, intents };
  if (exactPhrase) parsed.exactPhrase = exactPhrase;
  return parsed;
}

function mergeFilters(...sources: Array<Partial<SearchFilters>>): SearchFilters {
  const out: SearchFilters = {};
  for (const src of sources) {
    for (const [key, value] of Object.entries(src)) {
      if (value == null) continue;
      const k = key as keyof SearchFilters;
      const existing = out[k];
      if (Array.isArray(existing) && Array.isArray(value)) {
        for (const v of value) pushUnique(existing as unknown[], v as never);
      } else if (existing == null) {
        (out as Record<string, unknown>)[k] = value;
      }
    }
  }
  return out;
}

// ── Human-readable interpretation ("understood as" chips) ─────────────────────

/**
 * Convert a parsed query into short human-readable chips describing what the
 * engine understood, for display next to the search bar.
 */
export function filtersToHumanReadable(parsed: ParsedQuery): string[] {
  const chips: string[] = [];
  const f = parsed.filters;

  if (parsed.exactPhrase) chips.push(`"${parsed.exactPhrase}"`);
  if (f.commodity?.length) chips.push(`Commodity: ${f.commodity.join(', ')}`);
  if (f.excludeCommodity?.length) chips.push(`Exclude: ${f.excludeCommodity.join(', ')}`);
  if (f.region?.length) chips.push(`Region: ${f.region.join(', ')}`);
  if (f.country?.length) chips.push(`Country: ${f.country.join(', ')}`);
  if (f.risk?.length) chips.push(`Risk: ${f.risk.join(', ')}`);
  if (f.status?.length) chips.push(`Status: ${f.status.join(', ')}`);
  if (f.roiMin != null) chips.push(`ROI ≥ ${round(f.roiMin)}%`);
  if (f.roiMax != null) chips.push(`ROI ≤ ${round(f.roiMax)}%`);
  if (f.termDaysMin != null) chips.push(`Term ≥ ${f.termDaysMin} days`);
  if (f.termDaysMax != null) chips.push(`Term ≤ ${f.termDaysMax} days`);
  if (f.valueMin != null) chips.push(`Value ≥ ${formatMoney(f.valueMin)}`);
  if (f.valueMax != null) chips.push(`Value ≤ ${formatMoney(f.valueMax)}`);
  if (f.esgMin != null) chips.push(`ESG ≥ ${round(f.esgMin)}`);
  if (f.quantityMin != null) chips.push(`Quantity ≥ ${f.quantityMin}`);
  if (f.quantityMax != null) chips.push(`Quantity ≤ ${f.quantityMax}`);
  if (f.createdAfter) chips.push(`Listed after ${shortDate(f.createdAfter)}`);
  if (f.createdBefore) chips.push(`Listed before ${shortDate(f.createdBefore)}`);
  if (parsed.terms.length) chips.push(`Text: ${parsed.terms.join(' ')}`);
  return chips;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatMoney(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}
