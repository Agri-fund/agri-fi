import type { HistoryEntry, SavedQuery } from './types';

const HISTORY_KEY = 'agrifi.advanced_search.history.v1';
const SAVED_KEY = 'agrifi.advanced_search.saved.v1';

/** Maximum number of history entries retained. */
export const HISTORY_CAP = 50;
/** Maximum number of saved queries retained. */
export const SAVED_CAP = 40;

function hasWindow(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage may be unavailable (private mode, quota) — treat as empty.
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Best-effort persistence only.
  }
}

function readList<T>(key: string): T[] {
  if (!hasWindow()) return [];
  const raw = readRaw(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Date.now() % 1000)}`;
}

/** Record a settled search. Consecutive identical queries collapse into one
 *  entry whose count is incremented rather than duplicated. */
export function recordQuery(
  raw: string,
  meta: { resultCount: number; latencyMs: number } = { resultCount: 0, latencyMs: 0 },
): HistoryEntry[] {
  if (!hasWindow() || !raw.trim()) return readList<HistoryEntry>(HISTORY_KEY);
  const history = readList<HistoryEntry>(HISTORY_KEY);
  const trimmed = raw.trim();

  if (history.length > 0 && history[0].raw === trimmed) {
    history[0] = {
      ...history[0],
      count: history[0].count + 1,
      at: Date.now(),
      resultCount: meta.resultCount,
      latencyMs: meta.latencyMs,
    };
  } else {
    history.unshift({
      id: makeId('h'),
      raw: trimmed,
      at: Date.now(),
      count: 1,
      resultCount: meta.resultCount,
      latencyMs: meta.latencyMs,
    });
  }

  const capped = history.slice(0, HISTORY_CAP);
  writeRaw(HISTORY_KEY, JSON.stringify(capped));
  return capped;
}

export function getHistory(): HistoryEntry[] {
  return readList<HistoryEntry>(HISTORY_KEY);
}

export function clearHistory(): HistoryEntry[] {
  if (!hasWindow()) return [];
  try {
    window.localStorage.removeItem(HISTORY_KEY);
  } catch {
    // ignore
  }
  return [];
}

/** Persist a query for reuse. Ignores duplicates of an existing saved query. */
export function saveQuery(raw: string, note?: string): SavedQuery[] {
  if (!hasWindow() || !raw.trim()) return readList<SavedQuery>(SAVED_KEY);
  const trimmed = raw.trim();
  const saved = readList<SavedQuery>(SAVED_KEY);
  if (saved.some((s) => s.raw === trimmed)) return saved;
  saved.unshift({ id: makeId('s'), raw: trimmed, savedAt: Date.now(), note });
  const capped = saved.slice(0, SAVED_CAP);
  writeRaw(SAVED_KEY, JSON.stringify(capped));
  return capped;
}

export function getSavedQueries(): SavedQuery[] {
  return readList<SavedQuery>(SAVED_KEY);
}

export function deleteSavedQuery(id: string): SavedQuery[] {
  if (!hasWindow()) return [];
  const remaining = readList<SavedQuery>(SAVED_KEY).filter((s) => s.id !== id);
  writeRaw(SAVED_KEY, JSON.stringify(remaining));
  return remaining;
}
