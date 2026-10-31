import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAdvancedSearch } from '@/hooks/useAdvancedSearch';
import { SAMPLE_DEALS } from '@/lib/advanced-search/sample-deals';
import { getHistory } from '@/lib/advanced-search/search-history';

describe('useAdvancedSearch hook (#1183)', () => {
  beforeEach(() => {
    localStorage.clear();
    (global.fetch as ReturnType<typeof vi.fn>).mockReset();
  });

  it('searches an explicit deal set, ranks, explains and records history', async () => {
    const { result } = renderHook(() =>
      useAdvancedSearch({ deals: SAMPLE_DEALS, debounceMs: 0 }),
    );

    await waitFor(() => expect(result.current.results.length).toBe(SAMPLE_DEALS.length));

    act(() => result.current.setQuery('cocoa'));
    await waitFor(() => {
      expect(result.current.results.length).toBeGreaterThan(0);
      expect(result.current.results.every((r) => r.deal.commodity === 'Cocoa')).toBe(true);
    });
    expect(result.current.results[0].explanation.length).toBeGreaterThan(0);
    expect(result.current.interpretedAs.length).toBeGreaterThan(0);
    expect(result.current.stats.latencyMs).toBeLessThan(1000);

    await waitFor(() => expect(getHistory().some((h) => h.raw === 'cocoa')).toBe(true));
  });

  it('exposes live autocomplete suggestions', () => {
    const { result } = renderHook(() =>
      useAdvancedSearch({ deals: SAMPLE_DEALS, debounceMs: 0 }),
    );
    act(() => result.current.setQuery('coc'));
    expect(result.current.suggestions.some((s) => s.text === 'cocoa')).toBe(true);
  });

  it('toggles and clears facets', async () => {
    const { result } = renderHook(() =>
      useAdvancedSearch({ deals: SAMPLE_DEALS, debounceMs: 0 }),
    );
    await waitFor(() => expect(result.current.results.length).toBe(SAMPLE_DEALS.length));

    act(() => result.current.toggleFacet('risk', 'Low'));
    expect(result.current.selectedFacets.risk).toContain('Low');

    act(() => result.current.toggleFacet('risk', 'Low'));
    expect(result.current.selectedFacets.risk).toBeUndefined();

    act(() => result.current.toggleFacet('risk', 'High'));
    const withHigh = result.current.results.length;
    act(() => result.current.clearFacets());
    expect(result.current.selectedFacets).toEqual({});
    await waitFor(() => expect(result.current.results.length).toBeGreaterThan(withHigh));
  });

  it('flags zero results for an impossible query', async () => {
    const { result } = renderHook(() =>
      useAdvancedSearch({ deals: SAMPLE_DEALS, debounceMs: 0 }),
    );
    act(() => result.current.setQuery('cocoa in Brazil'));
    await waitFor(() => expect(result.current.zeroResults).toBe(true));
    expect(result.current.results).toHaveLength(0);
  });

  it('falls back to bundled sample deals and logs when the API is unreachable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useAdvancedSearch({ debounceMs: 0 }));

    await waitFor(() => expect(result.current.usingFallbackData).toBe(true));
    expect(result.current.results.length).toBe(SAMPLE_DEALS.length);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
