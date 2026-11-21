/** Marketplace filter state and its mapping to the `/trade-deals` query string. */

export const COMMODITIES = [
  "maize",
  "wheat",
  "coffee",
  "cocoa",
  "rice",
  "soybean",
];
export const DURATION_OPTIONS = [
  "<3 months",
  "3-6 months",
  "6-12 months",
  ">12 months",
] as const;
export const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "highest_roi", label: "Highest ROI" },
  { value: "closing_soon", label: "Closing soon" },
  { value: "most_funded", label: "Most funded" },
  { value: "largest_amount", label: "Largest amount" },
] as const;
export const STATUS_OPTIONS = [
  "open",
  "almost funded",
  "fully funded",
] as const;
export const RISK_OPTIONS = ["Low", "Medium", "High"] as const;

export interface Filters {
  q: string;
  commodity: string[];
  country: string;
  region: string;
  minAmount: number;
  maxAmount: number;
  minRoi: number;
  maxRoi: number;
  duration: string;
  riskRating: string;
  status: string;
  sortBy: string;
}

export const DEFAULT_FILTERS: Filters = {
  q: "",
  commodity: [],
  country: "",
  region: "",
  minAmount: 0,
  maxAmount: 5000,
  minRoi: 0,
  maxRoi: 100,
  duration: "",
  riskRating: "",
  status: "",
  sortBy: "newest",
};

/** Filter object as stored by the backend (only non-default values). */
export type ApiFilters = Record<string, string | number>;

function num(raw: string | null, fallback: number): number {
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function parseFilters(params: URLSearchParams): Filters {
  return {
    q: params.get("q") ?? "",
    commodity:
      params
        .get("commodity")
        ?.split(",")
        .map((c) => c.trim())
        .filter(Boolean) ?? [],
    country: params.get("country") ?? "",
    region: params.get("region") ?? "",
    minAmount: num(params.get("minAmount"), DEFAULT_FILTERS.minAmount),
    maxAmount: num(params.get("maxAmount"), DEFAULT_FILTERS.maxAmount),
    minRoi: num(params.get("minRoi"), DEFAULT_FILTERS.minRoi),
    maxRoi: num(params.get("maxRoi"), DEFAULT_FILTERS.maxRoi),
    duration: params.get("duration") ?? "",
    riskRating: params.get("riskRating") ?? "",
    status: params.get("status") ?? "",
    sortBy: params.get("sortBy") ?? DEFAULT_FILTERS.sortBy,
  };
}

/** Only the criteria that differ from the defaults, ready for the API. */
export function toApiFilters(f: Filters): ApiFilters {
  const out: ApiFilters = {};
  if (f.q) out.q = f.q;
  if (f.commodity.length > 0) out.commodity = f.commodity.join(",");
  if (f.country) out.country = f.country;
  if (f.region) out.region = f.region;
  if (f.minAmount > 0) out.minAmount = f.minAmount;
  if (f.maxAmount < DEFAULT_FILTERS.maxAmount) out.maxAmount = f.maxAmount;
  if (f.minRoi > 0) out.minRoi = f.minRoi;
  if (f.maxRoi < DEFAULT_FILTERS.maxRoi) out.maxRoi = f.maxRoi;
  if (f.duration) out.duration = f.duration;
  if (f.riskRating) out.riskRating = f.riskRating;
  if (f.status) out.status = f.status;
  if (f.sortBy && f.sortBy !== DEFAULT_FILTERS.sortBy) out.sortBy = f.sortBy;
  return out;
}

export function fromApiFilters(api: ApiFilters): Filters {
  const params = new URLSearchParams();
  Object.entries(api).forEach(([k, v]) => params.set(k, String(v)));
  return parseFilters(params);
}

export function buildQuery(filters: Filters, page = 1, limit?: number): string {
  const params = new URLSearchParams();
  Object.entries(toApiFilters(filters)).forEach(([k, v]) =>
    params.set(k, String(v)),
  );
  if (page > 1) params.set("page", String(page));
  if (limit) params.set("limit", String(limit));
  return params.toString();
}

/** Same checks as the backend, so the UI can explain a problem before sending. */
export function validateFilters(f: Filters): string[] {
  const errors: string[] = [];
  if (f.minAmount > f.maxAmount)
    errors.push("Minimum investment is above the maximum.");
  if (f.minRoi > f.maxRoi) errors.push("Minimum ROI is above the maximum.");
  return errors;
}

/** Short human-readable label for history and saved search rows. */
export function describeFilters(api: ApiFilters): string {
  const parts = Object.entries(api)
    .filter(([k]) => k !== "sortBy")
    .map(([k, v]) => `${k}: ${v}`);
  return parts.length > 0 ? parts.join(", ") : "All deals";
}
