'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { getOpenDeals, Deal } from '@/lib/api';
import MarketplaceSkeleton from '@/components/marketplace/MarketplaceSkeleton';
import Pagination from '@/components/ui/Pagination';
import DealCard from '@/components/marketplace/DealCard';

const LIMIT = 12;
const SEARCH_DEBOUNCE_MS = 300;
const SKELETON_FALLBACK_COUNT = 6;

function parsePageParam(raw: string | null): number {
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function MarketplaceContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlPage = parsePageParam(searchParams.get('page'));
  const urlSearch = searchParams.get('q') ?? '';

  const [deals, setDeals] = useState<Deal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState(urlSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(urlSearch);

  // Keep the local search input in sync if the URL changes from elsewhere
  // (e.g. back/forward navigation, deep-link load).
  useEffect(() => {
    setSearchInput(urlSearch);
    setDebouncedSearch(urlSearch);
  }, [urlSearch]);

  // Debounce the visible search input by 300ms before committing it.
  useEffect(() => {
    if (searchInput === debouncedSearch) return;
    const timer = setTimeout(() => setDebouncedSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, debouncedSearch]);

  // Push the debounced search into the URL, resetting page=1 when the query
  // actually changes so a filtered list doesn't open on an empty page.
  useEffect(() => {
    if (debouncedSearch === urlSearch) return;
    const params = new URLSearchParams(searchParams.toString());
    if (debouncedSearch) {
      params.set('q', debouncedSearch);
    } else {
      params.delete('q');
    }
    params.delete('page');
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [debouncedSearch, urlSearch, pathname, router, searchParams]);

  useEffect(() => {
    setLoading(true);
    getOpenDeals(urlPage, LIMIT)
      .then((res) => {
        setDeals(res.data);
        setTotal(res.total);
      })
      .catch(() => setDeals([]))
      .finally(() => setLoading(false));
  }, [urlPage]);

  const filtered = useMemo(() => {
    if (!debouncedSearch) return deals;
    const needle = debouncedSearch.toLowerCase();
    return deals.filter((d) => d.commodity.toLowerCase().includes(needle));
  }, [deals, debouncedSearch]);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const goToPage = (next: number) => {
    if (next < 1 || next > totalPages || next === urlPage) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === 1) {
      params.delete('page');
    } else {
      params.set('page', String(next));
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const clearSearch = () => setSearchInput('');

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Navbar */}
      <nav className="glass sticky top-0 z-20 border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-14">
          <Link href="/" className="flex items-center gap-2 font-black text-slate-900">
            <span className="text-xl">🌾</span> AgriFi
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/login"    className="btn-secondary text-sm px-4 py-2">Sign in</Link>
            <Link href="/register" className="btn-primary  text-sm px-4 py-2">Get Started</Link>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {/* Page header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <span className="badge-green">Live</span>
            <span className="text-xs text-slate-400">{total} open deal{total !== 1 ? 's' : ''}</span>
          </div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight mb-2">Marketplace</h1>
          <p className="text-slate-500 text-lg">Browse open agricultural investment opportunities</p>
        </div>

        {/* Search */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          <div className="relative flex-1 max-w-md">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
              </svg>
            </span>
            <input
              className="input pl-10"
              placeholder="Search by commodity…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Search deals by commodity"
            />
          </div>
          {searchInput && (
            <button onClick={clearSearch} className="btn-secondary text-sm px-4">
              Clear ×
            </button>
          )}
        </div>

        {/* Grid */}
        {loading ? (
          <MarketplaceSkeleton count={SKELETON_FALLBACK_COUNT} />
        ) : filtered.length === 0 ? (
          <div className="card p-16 text-center">
            <p className="text-5xl mb-4">🌾</p>
            <h3 className="font-bold text-slate-900 text-xl mb-2">No deals found</h3>
            <p className="text-slate-500">
              {debouncedSearch ? `No results for "${debouncedSearch}"` : 'Check back soon for new opportunities'}
            </p>
            {debouncedSearch && (
              <button onClick={clearSearch} className="btn-primary mt-4 mx-auto">
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filtered.map((deal) => <DealCard key={deal.id} deal={deal} />)}
          </div>
        )}

        {/* Pagination */}
        <Pagination page={urlPage} totalPages={totalPages} onChange={goToPage} />
      </div>
    </div>
  );
}

export default function MarketplacePage() {
  return (
    <Suspense fallback={<MarketplaceSkeleton count={SKELETON_FALLBACK_COUNT} />}>
      <MarketplaceContent />
    </Suspense>
  );
}
