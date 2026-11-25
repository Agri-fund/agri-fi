"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SavedSearch,
  SearchHistoryEntry,
  createSavedSearch,
  deleteSavedSearch,
  getStoredToken,
  listSavedSearches,
  listSearchHistory,
  recordSearch,
} from "@/lib/api";
import { ApiFilters, describeFilters } from "@/lib/deal-filters";

interface Props {
  /** Active criteria that differ from the defaults. */
  filters: ApiFilters;
  /** Result count of the last completed search. */
  total: number;
  loading: boolean;
  onApply: (filters: ApiFilters) => void;
}

/** Saved searches (with alerts) and recent search history for the marketplace. */
export default function SavedSearchesPanel({
  filters,
  total,
  loading,
  onApply,
}: Props) {
  const [authed, setAuthed] = useState(false);
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [name, setName] = useState("");
  const [notifyInApp, setNotifyInApp] = useState(true);
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastRecorded = useRef("");

  const reload = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([
        listSavedSearches(),
        listSearchHistory(),
      ]);
      setSaved(s);
      setHistory(h);
    } catch {
      setError("Could not load saved searches.");
    }
  }, []);

  useEffect(() => {
    const hasToken = Boolean(getStoredToken());
    setAuthed(hasToken);
    if (hasToken) void reload();
  }, [reload]);

  const filtersKey = JSON.stringify(filters);

  // Record each settled, non-empty search once (best effort).
  useEffect(() => {
    if (!authed || loading || Object.keys(filters).length === 0) return;
    if (lastRecorded.current === filtersKey) return;
    lastRecorded.current = filtersKey;
    recordSearch(filters, total)
      .then(() => listSearchHistory().then(setHistory))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, loading, filtersKey, total]);

  if (!authed) {
    return (
      <p className="mt-6 text-xs text-slate-500">
        Sign in to save searches and get alerts for new matching deals.
      </p>
    );
  }

  const save = async () => {
    setError(null);
    try {
      await createSavedSearch({
        name: name.trim(),
        filters,
        notifyInApp,
        notifyEmail,
      });
      setName("");
      await reload();
    } catch (e: any) {
      const errors: string[] | undefined = e?.response?.data?.errors;
      setError(errors?.join(" ") ?? e?.message ?? "Could not save search.");
    }
  };

  const remove = async (id: string) => {
    await deleteSavedSearch(id).catch(() => undefined);
    await reload();
  };

  return (
    <section className="mt-6 space-y-5" aria-label="Saved searches">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-slate-400 mb-2">
          Save this search
        </p>
        <input
          className="input"
          placeholder="Name, e.g. Low-risk cocoa"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          aria-label="Saved search name"
        />
        <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={notifyInApp}
            onChange={(e) => setNotifyInApp(e.target.checked)}
          />
          Notify me in the app
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={notifyEmail}
            onChange={(e) => setNotifyEmail(e.target.checked)}
          />
          Notify me by email
        </label>
        <button
          type="button"
          className="btn-primary mt-3 w-full text-sm"
          disabled={!name.trim()}
          onClick={save}
        >
          Save search
        </button>
        {error && (
          <p className="mt-2 text-xs text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>

      {saved.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400 mb-2">
            Saved
          </p>
          <ul className="space-y-2">
            {saved.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <button
                  type="button"
                  className="truncate text-left font-semibold text-emerald-700 hover:underline"
                  title={describeFilters(s.filters)}
                  onClick={() => onApply(s.filters)}
                >
                  {s.name}
                </button>
                <button
                  type="button"
                  className="text-slate-400 hover:text-red-600"
                  aria-label={`Delete saved search ${s.name}`}
                  onClick={() => remove(s.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {history.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400 mb-2">
            Recent searches
          </p>
          <ul className="space-y-1">
            {history.slice(0, 8).map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  className="w-full truncate text-left text-sm text-slate-600 hover:text-emerald-700"
                  onClick={() => onApply(h.filters)}
                >
                  {describeFilters(h.filters)} ({h.resultCount})
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
