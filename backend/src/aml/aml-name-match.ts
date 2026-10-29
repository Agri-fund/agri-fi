/**
 * Name normalisation and similarity scoring for sanctions / PEP screening
 * (#1217).
 *
 * Sanctions lists and KYC records describe the same person with different
 * punctuation, case, transliterations and legal-form suffixes, so matching runs
 * on a normalised token set rather than raw strings. Scoring is intentionally
 * conservative and explainable: the components that produced a score are
 * returned with it, because a compliance officer has to defend the decision.
 */

const NOISE_TOKENS = new Set([
  'limited',
  'ltd',
  'incorporated',
  'inc',
  'corp',
  'corporation',
  'co',
  'company',
  'holding',
  'group',
  'the',
  'of',
  'and',
]);

/** Lowercase, strip diacritics and punctuation, drop legal-form noise words. */
export function normaliseSanctionsName(name: string): string {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !NOISE_TOKENS.has(token))
    .join(' ');
}

/** Ordered unique tokens of a normalised name. */
export function normaliseTokenSet(name: string): string[] {
  const normalised = normaliseSanctionsName(name);
  if (!normalised) return [];
  return [...new Set(normalised.split(' '))];
}

export interface NameScoreComponents {
  score: number;
  exactMatch: boolean;
  sharedTokens: string[];
  method: 'exact' | 'token_overlap' | 'partial' | 'none';
}

/**
 * 0-100 similarity between a subject name and a listed entry (including its
 * aliases). Full token-set equality scores 100; a name that shares every token
 * except one scores in the review band; unrelated names score 0.
 */
export function scoreNameSimilarity(
  subjectName: string,
  entry: { name: string; aliases?: string[] },
): NameScoreComponents {
  const subject = normaliseTokenSet(subjectName);
  if (subject.length === 0)
    return { score: 0, exactMatch: false, sharedTokens: [], method: 'none' };

  const candidates = [entry.name, ...(entry.aliases ?? [])];
  let best: NameScoreComponents = {
    score: 0,
    exactMatch: false,
    sharedTokens: [],
    method: 'none',
  };

  for (const candidate of candidates) {
    const listed = normaliseTokenSet(candidate);
    if (listed.length === 0) continue;
    const shared = subject.filter((token) => listed.includes(token));
    const union = new Set([...subject, ...listed]);
    const jaccard = shared.length / union.size;

    let score = Math.round(jaccard * 100);
    let method: NameScoreComponents['method'] = 'partial';
    const exact =
      normaliseSanctionsName(subjectName) === normaliseSanctionsName(candidate);

    if (exact) {
      score = 100;
      method = 'exact';
    } else if (
      (subject.length >= 2 && shared.length === subject.length) ||
      (listed.length >= 2 && shared.length === listed.length)
    ) {
      // One name is fully contained in the other (middle names, transliteration
      // variants) - strong but not identical.
      score = Math.max(score, 90);
      method = 'token_overlap';
    } else if (shared.length >= 2) {
      score = Math.max(score, 70 + (shared.length - 2) * 5);
      method = 'token_overlap';
    } else if (
      shared.length === 1 &&
      subject.length <= 2 &&
      listed.length <= 2
    ) {
      // Single-token names are too weak to block on; keep them in the review band.
      score = Math.min(score, 65);
      method = 'partial';
    } else if (shared.length === 0) {
      score = 0;
      method = 'none';
    }

    if (score > best.score) {
      best = { score, exactMatch: exact, sharedTokens: shared, method };
    }
  }

  return best;
}

/**
 * Date of birth agreement. Sanctions lists store partial dates ("1960",
 * "1960-04"), so agreement is graded rather than boolean.
 */
export function dateOfBirthAgreement(
  subjectDob?: string | null,
  entryDob?: string | null,
): number {
  if (!subjectDob || !entryDob) return 0;
  const subject = String(subjectDob).trim();
  const listed = String(entryDob).trim();
  if (subject === listed) return 8;
  if (subject.length >= 4 && listed.startsWith(subject.slice(0, 4))) return 4;
  if (listed.length >= 4 && subject.startsWith(listed.slice(0, 4))) return 4;
  return 0;
}
