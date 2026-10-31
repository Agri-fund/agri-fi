'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Clock, Bookmark, Trash2, X } from 'lucide-react';
import {
  getHistory,
  clearHistory,
  saveQuery,
  getSavedQueries,
  deleteSavedQuery,
} from '@/lib/advanced-search/search-history';
import type { HistoryEntry, SavedQuery } from '@/lib/advanced-search/types';

export interface SearchHistoryPanelProps {
  currentQuery: string;
  onSelect: (raw: string) => void;
  version?: number;
}

export default function SearchHistoryPanel({
  currentQuery,
  onSelect,
  version = 0,
}: SearchHistoryPanelProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [saved, setSaved] = useState<SavedQuery[]>([]);

  const refresh = useCallback(() => {
    setHistory(getHistory());
    setSaved(getSavedQueries());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, version]);

  const handleClear = () => {
    clearHistory();
    refresh();
  };

  const handleSave = () => {
    if (!currentQuery.trim()) return;
    saveQuery(currentQuery.trim());
    refresh();
  };

  const handleDeleteSaved = (id: string) => {
    deleteSavedQuery(id);
    refresh();
  };

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
            <Bookmark className="h-4 w-4 text-emerald-500" aria-hidden="true" /> Saved queries
          </h3>
          <button
            type="button"
            onClick={handleSave}
            disabled={!currentQuery.trim()}
            className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save current
          </button>
        </div>
        {saved.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No saved queries yet.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {saved.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-1.5 dark:border-slate-800"
              >
                <button
                  type="button"
                  onClick={() => onSelect(entry.raw)}
                  className="truncate text-left text-sm text-slate-700 hover:text-emerald-700 dark:text-slate-200"
                >
                  {entry.raw}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteSaved(entry.id)}
                  aria-label={`Delete saved query ${entry.raw}`}
                  className="ml-2 shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
            <Clock className="h-4 w-4 text-slate-400" aria-hidden="true" /> Recent searches
          </h3>
          {history.length > 0 && (
            <button
              type="button"
              onClick={handleClear}
              className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-red-600 dark:text-slate-400"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear history
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Your searches will appear here.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {history.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onSelect(entry.raw)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <span className="truncate">{entry.raw}</span>
                  <span className="ml-2 shrink-0 text-xs text-slate-400">
                    {entry.resultCount} result{entry.resultCount === 1 ? '' : 's'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
