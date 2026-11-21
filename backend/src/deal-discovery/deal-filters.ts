import { BadRequestException } from '@nestjs/common';

export const DEAL_SORT_VALUES = [
  'newest',
  'highest_roi',
  'closing_soon',
  'most_funded',
  'largest_amount',
  'highest_esg',
] as const;
export type DealSortBy = (typeof DEAL_SORT_VALUES)[number];

export const DURATION_BUCKETS = [
  '<3 months',
  '3-6 months',
  '6-12 months',
  '>12 months',
] as const;
export type DealDurationBucket = (typeof DURATION_BUCKETS)[number];

export const RISK_RATINGS = ['Low', 'Medium', 'High'] as const;
export const FUNDING_STATUSES = [
  'open',
  'almost funded',
  'fully funded',
] as const;
export type FundingStatus = (typeof FUNDING_STATUSES)[number];

/** Marketplace filter criteria, shared by the listing, saved searches and alerts. */
export interface DealFilters {
  commodity?: string;
  country?: string;
  region?: string;
  minAmount?: number;
  maxAmount?: number;
  minRoi?: number;
  maxRoi?: number;
  duration?: DealDurationBucket;
  riskRating?: (typeof RISK_RATINGS)[number];
  status?: FundingStatus;
  q?: string;
  sortBy?: DealSortBy;
}

export function bucketToDayRange(
  bucket?: DealDurationBucket,
): [number, number] | null {
  if (!bucket) return null;
  if (bucket === '<3 months') return [0, 90];
  if (bucket === '3-6 months') return [91, 180];
  if (bucket === '6-12 months') return [181, 365];
  return [366, Number.MAX_SAFE_INTEGER];
}

/** Returns a message per problem; an empty array means the combination is valid. */
export function validateDealFilters(f: DealFilters): string[] {
  const errors: string[] = [];
  const num = (name: keyof DealFilters, max: number) => {
    const v = f[name];
    if (v === undefined) return;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) {
      errors.push(`${name} must be a number between 0 and ${max}`);
    }
  };
  num('minAmount', 1e12);
  num('maxAmount', 1e12);
  num('minRoi', 1000);
  num('maxRoi', 1000);

  if (
    f.minAmount !== undefined &&
    f.maxAmount !== undefined &&
    f.minAmount > f.maxAmount
  ) {
    errors.push('minAmount cannot be greater than maxAmount');
  }
  if (f.minRoi !== undefined && f.maxRoi !== undefined && f.minRoi > f.maxRoi) {
    errors.push('minRoi cannot be greater than maxRoi');
  }
  if (f.duration && !DURATION_BUCKETS.includes(f.duration)) {
    errors.push(`duration must be one of: ${DURATION_BUCKETS.join(', ')}`);
  }
  if (f.riskRating && !RISK_RATINGS.includes(f.riskRating)) {
    errors.push(`riskRating must be one of: ${RISK_RATINGS.join(', ')}`);
  }
  if (f.status && !FUNDING_STATUSES.includes(f.status)) {
    errors.push(`status must be one of: ${FUNDING_STATUSES.join(', ')}`);
  }
  if (f.sortBy && !DEAL_SORT_VALUES.includes(f.sortBy)) {
    errors.push(`sortBy must be one of: ${DEAL_SORT_VALUES.join(', ')}`);
  }
  if (f.q !== undefined && f.q.length > 100) {
    errors.push('q must be at most 100 characters');
  }
  return errors;
}

export function assertValidDealFilters(f: DealFilters): void {
  const errors = validateDealFilters(f);
  if (errors.length > 0) {
    throw new BadRequestException({
      message: 'Invalid filter combination',
      errors,
    });
  }
}

/** The deal fields a filter match needs. */
export interface MatchableDeal {
  commodity: string;
  country?: string | null;
  region?: string | null;
  title?: string | null;
  shortDescription?: string | null;
  longDescription?: string | null;
  minInvestmentLot?: number | string | null;
  expectedRoi?: number | string | null;
  durationDays?: number | null;
  riskRating?: string | null;
  totalInvested: number | string;
  totalValue: number | string;
}

/** In-memory counterpart of the SQL filters in `TradeDealsService.findOpen`. */
export function dealMatchesFilters(
  deal: MatchableDeal,
  f: DealFilters,
): boolean {
  const lower = (s?: string | null) => (s ?? '').toLowerCase();
  const n = (v?: number | string | null) => Number(v ?? 0);

  const commodities = f.commodity
    ?.split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  if (commodities?.length && !commodities.includes(lower(deal.commodity))) {
    return false;
  }
  if (f.country && !lower(deal.country).includes(f.country.toLowerCase())) {
    return false;
  }
  if (f.region && !lower(deal.region).includes(f.region.toLowerCase())) {
    return false;
  }
  const lot = n(deal.minInvestmentLot);
  if (f.minAmount !== undefined && lot < f.minAmount) return false;
  if (f.maxAmount !== undefined && lot > f.maxAmount) return false;
  const roi = n(deal.expectedRoi);
  if (f.minRoi !== undefined && roi < f.minRoi) return false;
  if (f.maxRoi !== undefined && roi > f.maxRoi) return false;

  const range = bucketToDayRange(f.duration);
  if (
    range &&
    (n(deal.durationDays) < range[0] || n(deal.durationDays) > range[1])
  ) {
    return false;
  }
  if (f.riskRating && deal.riskRating !== f.riskRating) return false;

  if (f.status) {
    const invested = n(deal.totalInvested);
    const value = n(deal.totalValue);
    const actual: FundingStatus =
      invested >= value
        ? 'fully funded'
        : invested >= value * 0.5
          ? 'almost funded'
          : 'open';
    if (actual !== f.status) return false;
  }
  if (f.q?.trim()) {
    const haystack = lower(
      `${deal.title ?? ''} ${deal.shortDescription ?? ''} ${deal.longDescription ?? ''}`,
    );
    if (
      !f.q
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .every((w) => haystack.includes(w))
    ) {
      return false;
    }
  }
  return true;
}

const FILTER_KEYS: (keyof DealFilters)[] = [
  'commodity',
  'country',
  'region',
  'minAmount',
  'maxAmount',
  'minRoi',
  'maxRoi',
  'duration',
  'riskRating',
  'status',
  'q',
  'sortBy',
];

/** Copies only known, defined filter keys so stored searches stay clean. */
export function pickDealFilters(raw: Record<string, unknown>): DealFilters {
  const out: Record<string, unknown> = {};
  for (const key of FILTER_KEYS) {
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') {
      out[key] = raw[key];
    }
  }
  return out as DealFilters;
}
