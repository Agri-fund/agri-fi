'use client';

import React, { useState } from 'react';
import type { Deal } from '@/lib/api';
import { Sparkles } from 'lucide-react';
import { useAdvancedSearch } from '@/hooks/useAdvancedSearch';
import AdvancedSearchBar from './AdvancedSearchBar';
import SearchResultCard from './SearchResultCard';
import SearchFacets from './SearchFacets';
import SearchHistoryPanel from './SearchHistoryPanel';
import SearchAnalyticsPanel from './SearchAnalyticsPanel';

type Tab = 'results' | 'refine' | 'history' | 'analytics';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'results', label: 'Results' },
  { key: 'refine', label: 'Refine' },
  { key: 'history', label: 'History' },
  { key: 'analytics', label: 'Analytics' },
];

export interface AdvancedSearchPanelProps {
  deals?: Deal[];
  initialQuery?: string;
}

export default function AdvancedSearchPanel({ deals, initialQuery }: AdvancedSearchPanelProps) {
  const {
    query,
    setQuery,
    results,
    facets,
    selectedFacets,
    toggleFacet,
    clearFacets,
    suggestions,
    loading,
    stats,
    interpretedAs,
    zeroResults,
    usingFallbackData,
    analytics,
    similarDeals,
  } = useAdvancedSearch({ deals });

  const [tab, setTab] = useState<Tab>('results');
  const [similarFor, setSimilarFor] = useState<string | null>(null);

  const selectedDeal = similarFor ? results.find((r) => r.deal.id === similarFor) : null;
  const similar = similarFor ? similarDeals(similarFor, 3) : [];

  const handleShowSimilar = (dealId: string) => {
    setSimilarFor(dealId);
    setTab('results');
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-1">
        <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-600">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Semantic & natural-language search
        </span>
        <h1 className="text-3xl font-black text-slate-900 dark:text-white">Advanced Deal Search</h1>
        <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
          Ask in plain language. The engine parses your intent, scores semantic similarity, ranks by
          relevance and explains why every deal matched.
        </p>
      </header>

      <AdvancedSearchBar
        query={query}
        onChange={setQuery}
        suggestions={suggestions}
        interpretedAs={interpretedAs}
      />

      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
        <span>
          {stats.resultCount} result{stats.resultCount === 1 ? '' : 's'}
        </span>
        <span aria-hidden="true">&middot;</span>
        <span>{stats.latencyMs}ms</span>
        <span aria-hidden="true">&middot;</span>
        <span>{stats.indexSize} deals indexed</span>
        {usingFallbackData && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            Offline sample data
          </span>
        )}
      </div>

      <div
        role="tablist"
        aria-label="Search sections"
        className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-2 text-sm font-semibold dark:border-slate-800"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`whitespace-nowrap rounded-xl px-4 py-2 transition ${
              tab === t.key
                ? 'bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && (
        <p className="text-sm text-slate-400" role="status">
          Searching…
        </p>
      )}

      {tab === 'results' && (
        <div className="space-y-4">
          {similarFor && selectedDeal && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-emerald-800 dark:text-emerald-300">
                  Similar deals to “{selectedDeal.deal.title ?? selectedDeal.deal.commodity}”
                </h2>
                <button
                  type="button"
                  onClick={() => setSimilarFor(null)}
                  className="text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
                >
                  Hide
                </button>
              </div>
              <ul className="mt-2 space-y-1">
                {similar.map((hit) => (
                  <li key={hit.id} className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200">
                    <button type="button" onClick={() => setSimilarFor(hit.id)} className="truncate hover:text-emerald-700">
                      {hit.deal.title ?? hit.deal.commodity}
                    </button>
                    <span className="ml-2 shrink-0 text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
                      {Math.round(hit.score * 100)}% similar
                    </span>
                  </li>
                ))}
                {similar.length === 0 && (
                  <li className="text-sm text-slate-500 dark:text-slate-400">No similar deals found.</li>
                )}
              </ul>
            </div>
          )}

          {zeroResults ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                No deals matched “{query}”.
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Try removing a filter or a word — for example “cocoa deals in Africa”.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {results.map((result) => (
                <SearchResultCard
                  key={result.deal.id}
                  result={result}
                  onShowSimilar={handleShowSimilar}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'refine' && (
        <SearchFacets
          facets={facets}
          selected={selectedFacets}
          onToggle={toggleFacet}
          onClear={clearFacets}
        />
      )}

      {tab === 'history' && (
        <SearchHistoryPanel currentQuery={query} onSelect={setQuery} />
      )}

      {tab === 'analytics' && <SearchAnalyticsPanel analytics={analytics} />}
    </div>
  );
}
