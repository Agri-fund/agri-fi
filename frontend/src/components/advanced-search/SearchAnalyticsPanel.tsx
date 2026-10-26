'use client';

import React from 'react';
import { BarChart3, AlertTriangle } from 'lucide-react';
import { SUB_SECOND_TARGET_MS, toReport } from '@/lib/advanced-search/search-analytics';
import type { SearchAnalyticsSummary } from '@/lib/advanced-search/types';

export interface SearchAnalyticsPanelProps {
  analytics: SearchAnalyticsSummary;
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-black text-slate-900 dark:text-white">{value}</p>
      {hint && <p className="text-[11px] text-emerald-600 dark:text-emerald-400">{hint}</p>}
    </div>
  );
}

export default function SearchAnalyticsPanel({ analytics }: SearchAnalyticsPanelProps) {
  const p95UnderTarget = analytics.p95LatencyMs < SUB_SECOND_TARGET_MS;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
          <BarChart3 className="h-4 w-4 text-emerald-500" aria-hidden="true" /> Search analytics
        </h3>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          Local query telemetry aggregated across this browser.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Total queries" value={String(analytics.totalQueries)} />
        <StatCard label="Zero-result" value={String(analytics.zeroResultQueries)} />
        <StatCard label="Avg latency" value={`${analytics.avgLatencyMs}ms`} />
        <StatCard label="p50 latency" value={`${analytics.p50LatencyMs}ms`} />
        <StatCard
          label="p95 latency"
          value={`${analytics.p95LatencyMs}ms`}
          hint={p95UnderTarget ? `Under ${SUB_SECOND_TARGET_MS}ms target` : 'Over target'}
        />
        <StatCard label="Under target" value={`${analytics.subSecondRate}%`} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Popular queries
          </h4>
          {analytics.topQueries.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">No data yet.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {analytics.topQueries.slice(0, 6).map((q) => (
                <li key={q.value} className="flex items-center justify-between text-sm">
                  <span className="truncate text-slate-700 dark:text-slate-200">{q.label}</span>
                  <span className="ml-2 shrink-0 text-xs tabular-nums text-slate-400">{q.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h4 className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" /> Zero-result queries
          </h4>
          {analytics.zeroResultQueryList.length === 0 ? (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Every logged query returned at least one deal.
            </p>
          ) : (
            <ul className="mt-1 space-y-1">
              {analytics.zeroResultQueryList.slice(0, 6).map((q) => (
                <li key={q.value} className="flex items-center justify-between text-sm">
                  <span className="truncate text-slate-700 dark:text-slate-200">{q.label}</span>
                  <span className="ml-2 shrink-0 text-xs tabular-nums text-slate-400">{q.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
        <summary className="cursor-pointer text-xs font-semibold text-slate-600 dark:text-slate-300">
          Text report
        </summary>
        <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-500 dark:text-slate-400">
          {toReport(analytics).join('\n')}
        </pre>
      </details>
    </div>
  );
}
