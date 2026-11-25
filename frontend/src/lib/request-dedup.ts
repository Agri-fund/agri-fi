// =============================================================================
// Issue #974 — In-flight request deduplication + short-TTL GET response cache.
//
// Shared by `fetchBackend()` (src/config/backend.ts) and the stateful API
// client (`apiFetch()` in src/lib/api.ts).
//
// This lives in its own module (instead of inside config/backend.ts) because
// backend.ts evaluates `BACKEND_URL` at import time and throws in production
// when the server-only env var is missing, so it can never be imported from
// client-side code such as lib/api.ts.
//
//  • Layer 1 — `inFlight` Map<string, Promise<Response>>: concurrent identical
//    GET/HEAD requests share ONE network call. Key = method + url + body hash
//    (+ a hash of the Authorization header so users never share responses).
//  • Layer 2 — `responseCache`: successful GET bodies are kept for
//    `RESPONSE_CACHE_TTL_MS` to absorb burst renders.
//  • Layer 3 — a mutation (POST/PUT/PATCH/DELETE) invalidates every cached /
//    in-flight GET on the same resource path.
//  • `clearFetchCache()` drops everything — call it on logout.
// =============================================================================

/** How long a successful GET response is served from memory. */
export const RESPONSE_CACHE_TTL_MS = 2_000;

/** Upper bound on cached entries so a long-lived tab cannot grow unbounded. */
const MAX_CACHE_ENTRIES = 200;

/** Request header callers can set to bypass dedup + cache for one request. */
export const NO_CACHE_HEADER = 'x-no-cache';

/** Path fragments that are session / PII sensitive and are never shared. */
const BYPASS_PATH_FRAGMENTS = ['/auth', '/kyc'];

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

interface CacheEntry {
  body: ArrayBuffer;
  status: number;
  statusText: string;
  headers: [string, string][];
  expiresAt: number;
}

const inFlight = new Map<string, Promise<Response>>();
const responseCache = new Map<string, CacheEntry>();

// ── Key helpers ──────────────────────────────────────────────────────────────

/** 32-bit FNV-1a — small, dependency-free and good enough for a cache key. */
function fnv1a(input: string | Uint8Array): string {
  let hash = 0x811c9dc5;
  if (typeof input === 'string') {
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  } else {
    for (let i = 0; i < input.length; i++) {
      hash ^= input[i];
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16);
}

/**
 * Hash a request body. Returns `null` when the body cannot be hashed
 * synchronously (FormData, Blob, streams) — such requests are never deduped.
 */
function hashBody(body: RequestInit['body']): string | null {
  if (body === undefined || body === null) return '';
  if (typeof body === 'string') return fnv1a(body);
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return fnv1a(body.toString());
  }
  if (body instanceof ArrayBuffer) return fnv1a(new Uint8Array(body));
  if (ArrayBuffer.isView(body)) {
    return fnv1a(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  }
  return null;
}

export function buildRequestKey(
  method: string,
  url: string,
  body?: RequestInit['body'],
  authorization?: string | null,
): string | null {
  const bodyHash = hashBody(body);
  if (bodyHash === null) return null;
  return `${method}:${url}:${bodyHash}:${authorization ? fnv1a(authorization) : ''}`;
}

function pathnameOf(url: string): string {
  try {
    const u = new URL(url, 'http://localhost');
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    return url.split('?')[0].replace(/\/+$/, '');
  }
}

/** `a` is `b`, or one is a path-segment prefix of the other. */
function sameResource(a: string, b: string): boolean {
  if (a === b) return true;
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function keyUrl(key: string): string {
  // key = METHOD:url:bodyHash:authHash — the url itself contains ':' (scheme,
  // port), so strip the method prefix and the two trailing segments.
  const withoutMethod = key.slice(key.indexOf(':') + 1);
  const parts = withoutMethod.split(':');
  return parts.slice(0, -2).join(':');
}

// ── Cache invalidation ───────────────────────────────────────────────────────

/**
 * Invalidate cached and in-flight GET responses whose URL contains
 * `pathPrefix`. With no argument the entire cache is flushed (use on logout).
 */
export function invalidateFetchCache(pathPrefix?: string): void {
  if (!pathPrefix) {
    clearFetchCache();
    return;
  }
  for (const key of [...responseCache.keys()]) {
    if (keyUrl(key).includes(pathPrefix)) responseCache.delete(key);
  }
  for (const key of [...inFlight.keys()]) {
    if (keyUrl(key).includes(pathPrefix)) inFlight.delete(key);
  }
}

/** Drop the dedup map and the response cache (call on auth logout). */
export function clearFetchCache(): void {
  inFlight.clear();
  responseCache.clear();
}

/** Invalidate every GET entry that targets the same resource as `url`. */
function invalidateResource(url: string): void {
  const target = pathnameOf(url);
  for (const key of [...responseCache.keys()]) {
    if (sameResource(pathnameOf(keyUrl(key)), target)) responseCache.delete(key);
  }
  for (const key of [...inFlight.keys()]) {
    if (sameResource(pathnameOf(keyUrl(key)), target)) inFlight.delete(key);
  }
}

// ── Response snapshots ───────────────────────────────────────────────────────

function fromEntry(entry: CacheEntry): Response {
  return new Response(NULL_BODY_STATUSES.has(entry.status) ? null : entry.body.slice(0), {
    status: entry.status,
    statusText: entry.statusText,
    headers: entry.headers,
  });
}

function storeInCache(key: string, entry: CacheEntry): void {
  if (responseCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (oldest !== undefined) responseCache.delete(oldest);
  }
  responseCache.set(key, entry);
}

/** Give each caller its own readable body (tolerates non-Response test doubles). */
function cloneResponse(response: Response): Response {
  return typeof response.clone === 'function' ? response.clone() : response;
}

// ── Public fetch wrapper ─────────────────────────────────────────────────────

function shouldBypass(url: string, headers: Headers): boolean {
  if (headers.get(NO_CACHE_HEADER)) return true;
  const path = pathnameOf(url);
  return BYPASS_PATH_FRAGMENTS.some((fragment) => path.includes(fragment));
}

/**
 * Drop-in replacement for `fetch()` that deduplicates concurrent identical
 * GET/HEAD requests, serves GETs from a short TTL cache and invalidates the
 * cache when a mutation hits the same resource.
 *
 * Every caller receives its own `Response` (a clone), so each can safely read
 * the body.
 */
export async function dedupedFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = new Headers(init?.headers);

  // The bypass header is a client-side hint only — never send it upstream.
  let forwardInit = init;
  if (headers.has(NO_CACHE_HEADER)) {
    const forwarded = new Headers(headers);
    forwarded.delete(NO_CACHE_HEADER);
    forwardInit = { ...init, headers: forwarded };
  }

  // Mutations always reach the server, then invalidate the touched resource.
  if (MUTATING_METHODS.has(method)) {
    // Invalidate before AND after: a GET started while the mutation is in
    // flight must not be able to repopulate the cache with stale data.
    invalidateResource(url);
    try {
      return await fetch(url, forwardInit);
    } finally {
      invalidateResource(url);
    }
  }

  if ((method !== 'GET' && method !== 'HEAD') || shouldBypass(url, headers)) {
    return fetch(url, forwardInit);
  }

  const key = buildRequestKey(method, url, init?.body, headers.get('authorization'));
  if (key === null) return fetch(url, forwardInit);

  if (method === 'GET') {
    const cached = responseCache.get(key);
    if (cached) {
      if (cached.expiresAt > Date.now()) return fromEntry(cached);
      responseCache.delete(key);
    }
  }

  const existing = inFlight.get(key);
  if (existing) return cloneResponse(await existing);

  const promise: Promise<Response> = fetch(url, forwardInit).then(async (response) => {
    // Only populate the cache if this request is still the registered one —
    // a mutation or logout in the meantime must win.
    if (
      method === 'GET' &&
      response.ok &&
      typeof response.clone === 'function' &&
      inFlight.get(key) === promise
    ) {
      const copy = response.clone();
      const body = await copy.arrayBuffer();
      if (inFlight.get(key) === promise) {
        storeInCache(key, {
          body,
          status: response.status,
          statusText: response.statusText,
          headers: [...response.headers.entries()],
          expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
        });
      }
    }
    return response;
  });

  inFlight.set(key, promise);
  const cleanup = () => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  };
  promise.then(cleanup, cleanup);

  return cloneResponse(await promise);
}
