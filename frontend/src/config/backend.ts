// =============================================================================
// Issue #974 — perf(frontend): Add request deduplication and caching to
// apiClient (SWR or fetch-in-flight reuse)
// https://github.com/Agri-fund/agri-fi/issues/974
//
// ─── PROBLEM ─────────────────────────────────────────────────────────────────
//
// fetchBackend() issues a brand-new network request on every single call.
// There is no awareness of an identical request that is already in-flight, and
// there is no short-lived cache for GET responses.
//
// Concretely, during a single dashboard mount:
//   • useDashboardData calls  GET /v1/users/me  and  GET /v1/investments
//   • useStellarWallet polls  GET /v1/users/me  independently
//   • The marketplace sidebar also fetches  GET /v1/deals
//
// All these calls are fired in the same render cycle.  With no dedup layer the
// server receives N identical requests for the same resource from one browser
// tab.  Under load this creates rate-limit pressure and unnecessary latency.
//
// ─── ROOT CAUSE ──────────────────────────────────────────────────────────────
//
// fetchBackend() has no module-level state — every invocation goes straight to
// the native fetch() API without checking whether the same URL is already
// being fetched.
//
// ─── PROPOSED IMPLEMENTATION ─────────────────────────────────────────────────
//
// Layer 1 — In-flight deduplication (zero new dependencies)
// ----------------------------------------------------------
// Keep a module-level Map that stores the Promise for every active fetch.
// Concurrent calls for the same key share the same Promise and therefore
// produce exactly ONE network request.
//
//   const inFlight = new Map<string, Promise<Response>>();
//
//   export async function fetchBackend(
//     path: string,
//     options?: RequestInit,
//   ): Promise<Response> {
//     const method = (options?.method ?? 'GET').toUpperCase();
//
//     // Only deduplicate safe, idempotent methods.
//     // POST / PATCH / DELETE must always reach the server.
//     if (method !== 'GET' && method !== 'HEAD') {
//       return fetch(buildUrl(path), options);
//     }
//
//     const key = `${method}:${buildUrl(path)}`;
//
//     if (inFlight.has(key)) return inFlight.get(key)!;
//
//     const promise = fetch(buildUrl(path), options)
//       .finally(() => inFlight.delete(key));
//
//     inFlight.set(key, promise);
//     return promise;
//   }
//
// Result: calling fetchBackend('/v1/deals') ten times simultaneously sends
// exactly one HTTP request; all ten callers share the resolved value.
//
//
// Layer 2 — Short-TTL response cache for GET endpoints
// -----------------------------------------------------
// After the in-flight promise resolves, store the parsed response body and an
// expiry timestamp.  Subsequent calls within the TTL window are served from
// memory without any network activity.
//
//   interface CacheEntry {
//     body: unknown;          // JSON-parsed response body
//     expiresAt: number;      // Date.now() + ttl
//   }
//
//   const responseCache = new Map<string, CacheEntry>();
//
// Recommended TTLs (tune based on observed mutation frequency):
//
//   Route prefix              TTL      Rationale
//   ─────────────────────     ──────   ─────────────────────────────────────
//   /v1/investments           60 000   Portfolio changes only after a tx
//   /v1/deals                 30 000   Listings updated on farmer edit
//   /v1/users/me              30 000   Profile/KYC status rarely flips
//   /v1/notifications         10 000   Near-real-time; short TTL acceptable
//   /v1/auth/*                SKIP     Always bypass — session-sensitive
//   /v1/kyc/*                 SKIP     Always bypass — PII-sensitive
//
// Bypass rules (never cache):
//   • method is not GET / HEAD
//   • path includes '/auth' or '/kyc'
//   • caller sets the custom header  x-no-cache: 1
//
//
// Layer 3 — Cache-invalidation helper (for post-mutation refetch)
// ---------------------------------------------------------------
// Expose a function that components call after a mutation to bust stale cache
// entries, so the next read fetches fresh data:
//
//   /**
//    * Invalidate all cached GET responses whose key contains `pathPrefix`.
//    * Call with no argument to flush the entire cache (e.g. on logout).
//    */
//   export function invalidateFetchCache(pathPrefix?: string): void {
//     if (!pathPrefix) {
//       responseCache.clear();
//       return;
//     }
//     for (const key of responseCache.keys()) {
//       if (key.includes(pathPrefix)) responseCache.delete(key);
//     }
//   }
//
// Usage after the investment form submits successfully:
//   invalidateFetchCache('/v1/investments');
//
//
// Layer 4 (optional) — SWR migration for highest-churn hooks
// -----------------------------------------------------------
// useDashboardData.ts already implements a hand-rolled stale-while-revalidate
// pattern.  Migrating it to SWR gives those features for free and removes the
// manual localStorage bookkeeping:
//
//   import useSWR from 'swr';   // npm install swr  (~7 KB gzip, MIT)
//
//   const fetcher = (path: string) =>
//     fetchBackend(path).then(r => r.json());
//
//   export function useDashboardData() {
//     const { data: user, error: userErr } = useSWR('/v1/users/me', fetcher, {
//       dedupingInterval: 30_000,   // built-in in-flight dedup
//       revalidateOnFocus: true,    // refresh when user returns to tab
//       revalidateOnReconnect: true,
//     });
//
//     const { data: investments, error: invErr } = useSWR(
//       '/v1/investments', fetcher,
//       { dedupingInterval: 60_000, revalidateOnFocus: false }
//     );
//
//     return {
//       data: user && investments ? { user, investments } : null,
//       loading: !user && !userErr,
//       error: userErr?.message ?? invErr?.message ?? null,
//       isOffline: !!(userErr || invErr),
//     };
//   }
//
// The mutate() function returned by useSWR replaces invalidateFetchCache()
// for hooks that have been migrated.
//
// ─── ACCEPTANCE CRITERIA MAPPING ─────────────────────────────────────────────
//
//  ✅  Deduped concurrent fetches (test with Promise.all)
//      → Layer 1.  Unit test:
//          const spy = jest.spyOn(global, 'fetch');
//          await Promise.all([
//            fetchBackend('/v1/deals'),
//            fetchBackend('/v1/deals'),
//            fetchBackend('/v1/deals'),
//          ]);
//          expect(spy).toHaveBeenCalledTimes(1);   // not 3
//
//  ✅  GET cache with TTL; test cache hit / expiry
//      → Layer 2.  Unit tests:
//          (a) Call twice within TTL  → fetch spy called once total.
//          (b) Call after TTL expires → fetch spy called twice total.
//          Use jest.useFakeTimers() to advance time without real waiting.
//
//  ✅  Dashboard network calls reduced (measurable via mock fetch counts)
//      → Layers 1 + 2 combined.  Integration test: render the full
//        <DashboardPage> and assert spy.calls.length ≤ unique API paths.
//
//  ✅  Cache-invalidation hook for post-mutation refetch
//      → Layer 3 (invalidateFetchCache) / Layer 4 (SWR mutate).
//
// ─── FILES TO MODIFY ─────────────────────────────────────────────────────────
//
//   frontend/src/config/backend.ts          ← dedup map + TTL cache (HERE)
//   frontend/src/lib/api.ts                 ← re-export invalidateFetchCache()
//   frontend/src/hooks/useDashboardData.ts  ← optional SWR migration
//   frontend/src/hooks/useStellarWallet.ts  ← remove duplicate GET calls
//   package.json (frontend)                 ← add "swr" if Layer 4 chosen
//
// =============================================================================

export function getBackendUrl(): string {
  const url = process.env.BACKEND_URL;

  if (!url && process.env.NODE_ENV === 'production') {
    throw new Error(
      'BACKEND_URL environment variable is required in production. ' +
      'Please set BACKEND_URL to your backend API endpoint.'
    );
  }

  return url || 'http://localhost:3001';
}

// Named export for direct use in API route files
export const BACKEND_URL = getBackendUrl();

const API_VERSION = '/v1';

// TODO (#974): Add the in-flight dedup Map and TTL responseCache here.
// All logic described in the documentation block above belongs in this
// function (or thin helpers called from it) so every fetchBackend() caller
// benefits automatically without any changes at the call site.
export async function fetchBackend(
  path: string,
  options?: RequestInit
): Promise<Response> {
  const backendUrl = getBackendUrl();
  const versionedPath = path.startsWith('/v1') || path.startsWith('/v2')
    ? path
    : `${API_VERSION}${path}`;
  const url = `${backendUrl}${versionedPath}`;

  try {
    const response = await fetch(url, options);
    return response;
  } catch (error) {
    throw {
      isBackendUnreachable: true,
      originalError: error,
    };
  }
}
