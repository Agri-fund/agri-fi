'use client';

import React from 'react';
import Link from 'next/link';
import { TrendingUp, Check } from 'lucide-react';
import type { RankedResult } from '@/lib/advanced-search/types';
import { roiPercent } from '@/lib/advanced-search/query-parser';

export interface SearchResultCardProps {
  result: RankedResult;
  onShowSimilar?: (dealId: string) => void;
}

function formatMoney(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

export default function SearchResultCard({ result, onShowSimilar }: SearchResultCardProps) {
  const { deal, score, explanation } = result;
  const roi = roiPercent(deal);
  const relevancePct = Math.round(score * 100);

  return (
    <article
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
      aria-label={`Search result ${deal.title ?? deal.commodity}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {deal.commodity}
            </span>
            {deal.risk_rating && (
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {deal.risk_rating} risk
              </span>
            )}
          </div>
          <h3 className="mt-1.5 truncate text-base font-bold text-slate-900 dark:text-white">
            {deal.title ?? deal.short_description ?? deal.commodity}
          </h3>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {[deal.country, deal.region].filter(Boolean).join(', ') || 'Location unspecified'}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-xs font-medium text-slate-400">Relevance</p>
          <div className="flex items-center justify-end gap-1 text-emerald-600 dark:text-emerald-400">
            <TrendingUp className="h-4 w-4" aria-hidden="true" />
            <span className="text-xl font-black leading-none">{relevancePct}%</span>
          </div>
          <div className="mt-1 h-1.5 w-20 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500"
              style={{ width: `${Math.min(100, relevancePct)}%` }}
            />
          </div>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-slate-400">Value</dt>
          <dd className="font-semibold text-slate-700 dark:text-slate-200">{formatMoney(deal.total_value)}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Expected ROI</dt>
          <dd className="font-semibold text-slate-700 dark:text-slate-200">
            {roi == null ? '—' : `${Math.round(roi * 10) / 10}%`}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Funded</dt>
          <dd className="font-semibold text-slate-700 dark:text-slate-200">
            {deal.total_value ? `${Math.round((deal.funded_amount / deal.total_value) * 100)}%` : '0%'}
          </dd>
        </div>
      </dl>

      {explanation.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3 dark:border-slate-800">
          {explanation.map((item, idx) => (
            <li
              key={`${item.field}-${idx}`}
              className="flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-300"
            >
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
              <span>{item.reason}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-center justify-between">
        <Link
          href={`/deals/${deal.id}`}
          className="text-sm font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
        >
          View deal
        </Link>
        {onShowSimilar && (
          <button
            type="button"
            onClick={() => onShowSimilar(deal.id)}
            className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline dark:text-slate-400"
          >
            Find similar deals
          </button>
        )}
      </div>
    </article>
  );
}
