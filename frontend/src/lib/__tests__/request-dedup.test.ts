import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RESPONSE_CACHE_TTL_MS,
  buildRequestKey,
  clearFetchCache,
  dedupedFetch,
  invalidateFetchCache,
} from '../request-dedup';
import { fetchBackend } from '../../config/backend';

const URL_DEALS = 'http://api.test/v1/deals';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('request dedup + response cache (#974)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let n: number;

  beforeEach(() => {
    vi.useFakeTimers();
    clearFetchCache();
    n = 0;
    fetchSpy = vi.fn(async () => jsonResponse({ call: ++n }));
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('two simultaneous identical GETs result in ONE network call', async () => {
    const [a, b] = await Promise.all([
      dedupedFetch(URL_DEALS),
      dedupedFetch(URL_DEALS),
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Each caller gets an independently readable body.
    expect(await a.json()).toEqual({ call: 1 });
    expect(await b.json()).toEqual({ call: 1 });
  });

  it('ten simultaneous GETs through fetchBackend share one request', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => fetchBackend('/deals')),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(10);
  });

  it('does not dedupe different URLs, auth headers or bodies', async () => {
    await Promise.all([
      dedupedFetch(`${URL_DEALS}?page=1`),
      dedupedFetch(`${URL_DEALS}?page=2`),
      dedupedFetch(URL_DEALS, { headers: { Authorization: 'Bearer a' } }),
      dedupedFetch(URL_DEALS, { headers: { Authorization: 'Bearer b' } }),
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(buildRequestKey('POST', URL_DEALS, '{"a":1}')).not.toBe(
      buildRequestKey('POST', URL_DEALS, '{"a":2}'),
    );
  });

  it('serves a repeat GET from cache inside the TTL and refetches after it', async () => {
    await dedupedFetch(URL_DEALS);
    vi.advanceTimersByTime(RESPONSE_CACHE_TTL_MS - 1);
    const hit = await dedupedFetch(URL_DEALS);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(await hit.json()).toEqual({ call: 1 });

    vi.advanceTimersByTime(2);
    await dedupedFetch(URL_DEALS);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not cache non-2xx responses', async () => {
    fetchSpy.mockImplementationOnce(async () => jsonResponse({ e: 1 }, 500));
    await dedupedFetch(URL_DEALS);
    await dedupedFetch(URL_DEALS);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('shares a rejection and lets the next call retry', async () => {
    fetchSpy.mockImplementationOnce(async () => {
      throw new Error('network down');
    });
    const results = await Promise.allSettled([
      dedupedFetch(URL_DEALS),
      dedupedFetch(URL_DEALS),
    ]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await dedupedFetch(URL_DEALS);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('bypasses /auth, /kyc and x-no-cache requests, and never forwards x-no-cache', async () => {
    await Promise.all([
      dedupedFetch('http://api.test/v1/auth/me'),
      dedupedFetch('http://api.test/v1/auth/me'),
      dedupedFetch('http://api.test/v1/kyc/status'),
      dedupedFetch('http://api.test/v1/kyc/status'),
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    fetchSpy.mockClear();
    await dedupedFetch(URL_DEALS, { headers: { 'x-no-cache': '1' } });
    await dedupedFetch(URL_DEALS, { headers: { 'x-no-cache': '1' } });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const sent = new Headers(fetchSpy.mock.calls[0][1].headers);
    expect(sent.has('x-no-cache')).toBe(false);
  });

  it('never dedupes mutations', async () => {
    await Promise.all([
      dedupedFetch(URL_DEALS, { method: 'POST', body: '{"a":1}' }),
      dedupedFetch(URL_DEALS, { method: 'POST', body: '{"a":1}' }),
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  describe('invalidation', () => {
    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
      '%s to the same resource path evicts cached GETs',
      async (method) => {
        await dedupedFetch(`${URL_DEALS}/42`);
        await dedupedFetch(URL_DEALS);
        await dedupedFetch('http://api.test/v1/investments');
        expect(fetchSpy).toHaveBeenCalledTimes(3);

        await dedupedFetch(`${URL_DEALS}/42`, { method, body: '{}' });
        fetchSpy.mockClear();

        await dedupedFetch(`${URL_DEALS}/42`); // same path → refetched
        await dedupedFetch(URL_DEALS); // parent collection → refetched
        await dedupedFetch('http://api.test/v1/investments'); // unrelated → cached
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      },
    );

    it('a mutation drops an in-flight GET so stale data is not cached', async () => {
      let release!: () => void;
      fetchSpy.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(jsonResponse({ stale: true }));
          }),
      );
      const pending = dedupedFetch(URL_DEALS);
      await dedupedFetch(URL_DEALS, { method: 'POST', body: '{}' });
      release();
      await pending;
      await vi.advanceTimersByTimeAsync(0);

      fetchSpy.mockClear();
      await dedupedFetch(URL_DEALS);
      expect(fetchSpy).toHaveBeenCalledTimes(1); // stale response was not cached
    });

    it('invalidateFetchCache(prefix) evicts matching entries only', async () => {
      await dedupedFetch(URL_DEALS);
      await dedupedFetch('http://api.test/v1/investments');
      invalidateFetchCache('/v1/deals');
      fetchSpy.mockClear();
      await dedupedFetch(URL_DEALS);
      await dedupedFetch('http://api.test/v1/investments');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('auth logout', () => {
    it('clearFetchCache empties the cache', async () => {
      await dedupedFetch(URL_DEALS);
      clearFetchCache();
      await dedupedFetch(URL_DEALS);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('clearFetchCache empties the in-flight map and blocks repopulation', async () => {
      let release!: () => void;
      fetchSpy.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(jsonResponse({ user: 'previous' }));
          }),
      );
      const pending = dedupedFetch(URL_DEALS);
      clearFetchCache();

      // A new caller (next user) must not join the previous in-flight request.
      await dedupedFetch(URL_DEALS);
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      release();
      await pending;
    });

    it('apiClient.clearAuth() clears the dedup state', async () => {
      const { apiClient } = await import('../api');
      await dedupedFetch(URL_DEALS);
      apiClient.clearAuth();
      await dedupedFetch(URL_DEALS);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });
});
