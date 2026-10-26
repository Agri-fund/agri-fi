import type { FacetValue, SearchAnalyticsRecord, SearchAnalyticsSummary } from './types';

const ANALYTICS_KEY = 'agrifi.advanced_search.analytics.v1';
export const ANALYTICS_CAP = 500;
export const SUB_SECOND_TARGET_MS = 1000;

function hasWindow(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/** Linear-interpolated percentile over an unsorted numeric sample (0-100 scale). */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  const weight = rank - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

/** Aggregate raw records into a summary. Pure — no storage, easy to unit test. */
export function buildSummary(records: SearchAnalyticsRecord[]): SearchAnalyticsSummary {
  const total = records.length;
  const latencies = records.map((r) => r.latencyMs).filter((n) => Number.isFinite(n));
  const zeroResult = records.filter((r) => r.resultCount === 0);
  const subSecond = latencies.filter((ms) => ms < SUB_SECOND_TARGET_MS).length;

  const byQuery = new Map<string, number>();
  for (const r of records) {
    const key = r.raw.trim();
    if (key) byQuery.set(key, (byQuery.get(key) ?? 0) + 1);
  }
  const topQueries: FacetValue[] = [...byQuery.entries()]
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  const zeroByQuery = new Map<string, number>();
  for (const r of zeroResult) {
    const key = r.raw.trim();
    if (key) zeroByQuery.set(key, (zeroByQuery.get(key) ?? 0) + 1);
  }
  const zeroResultQueryList: FacetValue[] = [...zeroByQuery.entries()]
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  const avg = total ? latencies.reduce((a, b) => a + b, 0) / total : 0;

  return {
    totalQueries: total,
    zeroResultQueries: zeroResult.length,
    avgLatencyMs: round(avg),
    p50LatencyMs: round(percentile(latencies, 50)),
    p95LatencyMs: round(percentile(latencies, 95)),
    subSecondRate: latencies.length ? round((subSecond / latencies.length) * 100) : 100,
    topQueries,
    zeroResultQueryList,
  };
}

/** Load persisted records (SSR-safe → empty). */
export function getRecords(): SearchAnalyticsRecord[] {
  if (!hasWindow()) return [];
  try {
    const raw = window.localStorage.getItem(ANALYTICS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SearchAnalyticsRecord[]) : [];
  } catch {
    return [];
  }
}

/** Append one settled-search record and persist. Returns the stored record. */
export function logQuery(record: SearchAnalyticsRecord): SearchAnalyticsRecord {
  if (!hasWindow()) return record;
  const records = getRecords();
  records.push(record);
  const capped = records.slice(-ANALYTICS_CAP);
  try {
    window.localStorage.setItem(ANALYTICS_KEY, JSON.stringify(capped));
  } catch {
    // best-effort
  }
  return record;
}

/** Aggregate persisted records into a summary. */
export function getAnalytics(): SearchAnalyticsSummary {
  return buildSummary(getRecords());
}

export function resetAnalytics(): SearchAnalyticsSummary {
  if (hasWindow()) {
    try {
      window.localStorage.removeItem(ANALYTICS_KEY);
    } catch {
      // ignore
    }
  }
  return buildSummary([]);
}

/** Human-readable report of search analytics (used by the analytics panel). */
export function toReport(summary: SearchAnalyticsSummary): string[] {
  const lines: string[] = [
    `Total queries: ${summary.totalQueries}`,
    `Zero-result queries: ${summary.zeroResultQueries}`,
    `Average latency: ${summary.avgLatencyMs}ms`,
    `p50 latency: ${summary.p50LatencyMs}ms (target < ${SUB_SECOND_TARGET_MS}ms)`,
    `p95 latency: ${summary.p95LatencyMs}ms`,
    `Under target: ${summary.subSecondRate}%`,
  ];
  if (summary.topQueries.length) {
    lines.push(`Top queries: ${summary.topQueries.slice(0, 5).map((q) => `${q.label} (${q.count})`).join(', ')}`);
  }
  return lines;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
