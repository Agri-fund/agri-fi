/**
 * Single source of truth for the auth token persisted in the browser.
 *
 * Every surface must read/write the token through these helpers instead of
 * touching localStorage directly — raw reads with mismatched keys (e.g.
 * `authToken` vs `auth_token`) silently broke authenticated calls before.
 */

/** Canonical storage key for the JWT access token. */
export const tokenKey = "auth_token";

/**
 * Keys written by older builds. They are still read (and migrated to
 * `tokenKey`) during the migration window, then removed on write/clear.
 */
export const legacyTokenKeys = ["authToken", "token"] as const;

function storages(): Storage[] {
  if (typeof window === "undefined") return [];
  const list: Storage[] = [];
  try {
    if (typeof localStorage !== "undefined") list.push(localStorage);
  } catch {
    // Access can throw in sandboxed iframes / blocked-storage modes
  }
  try {
    if (typeof sessionStorage !== "undefined") list.push(sessionStorage);
  } catch {
    // ignore
  }
  return list;
}

function safeGet(store: Storage, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function safeRemove(store: Storage, key: string) {
  try {
    store.removeItem(key);
  } catch {
    // ignore
  }
}

/** Returns the stored auth token, or null (always null during SSR). */
export function getAuthToken(): string | null {
  const [local, session] = storages();
  if (!local) return null;

  const current = safeGet(local, tokenKey);
  if (current) return current;

  // Migration window: pick up a token stored under a legacy key and move it
  // to the canonical key so subsequent reads are consistent.
  for (const store of [local, session].filter(Boolean) as Storage[]) {
    for (const key of legacyTokenKeys) {
      const legacy = safeGet(store, key);
      if (legacy) {
        setAuthToken(legacy);
        return legacy;
      }
    }
  }
  return null;
}

/** Persists the auth token under the canonical key and drops legacy copies. */
export function setAuthToken(value: string): void {
  const [local, session] = storages();
  if (!local) return;
  try {
    local.setItem(tokenKey, value);
  } catch {
    return;
  }
  for (const store of [local, session].filter(Boolean) as Storage[]) {
    for (const key of legacyTokenKeys) safeRemove(store, key);
  }
}

/** Removes the auth token (canonical and legacy keys) from all storages. */
export function clearAuthToken(): void {
  for (const store of storages()) {
    safeRemove(store, tokenKey);
    for (const key of legacyTokenKeys) safeRemove(store, key);
  }
}

/** Convenience: `{ Authorization: 'Bearer …' }` or `{}` when signed out. */
export function authHeader(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
