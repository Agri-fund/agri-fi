'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { getOpenDeals, Deal } from '@/lib/api';
import MarketplaceSkeleton from '@/components/marketplace/MarketplaceSkeleton';
import Pagination from '@/components/ui/Pagination';

const LIMIT = 12;
const SEARCH_DEBOUNCE_MS = 300;
const SKELETON_FALLBACK_COUNT = 6;

const STATUS_CONFIG: Record<string, { cls: string; dot: string }> = {
  open:      { cls: 'badge-green',  dot: 'bg-emerald-500' },
  funded:    { cls: 'badge-blue',   dot: 'bg-blue-500' },
  draft:     { cls: 'badge-gray',   dot: 'bg-slate-400' },
  delivered: { cls: 'badge-purple', dot: 'bg-violet-500' },
  completed: { cls: 'badge-gray',   dot: 'bg-slate-400' },
  failed:    { cls: 'badge-red',    dot: 'bg-red-500' },
};

function DealCard({ deal }: { deal: Deal }) {
  const pct = deal.total_value > 0
    ? Math.min((Number(deal.total_invested) / Number(deal.total_value)) * 100, 100) : 0;
  const tokensLeft = Math.max(0, Number(deal.token_count) - Math.floor(Number(deal.total_invested) / 100));
  const sc = STATUS_CONFIG[deal.status] ?? STATUS_CONFIG.draft;
  const daysLeft = Math.max(0, Math.ceil((new Date(deal.delivery_date).getTime() - Date.now()) / 86400000));

  return (
    <Link href={`/marketplace/${deal.id}`}
      className="card-interactive flex flex-col overflow-hidden group">
      {/* Top accent bar */}
      <div className={`h-1.5 w-full ${pct >= 100 ? 'bg-gradient-to-r from-blue-400 to-indigo-500' : 'bg-gradient-to-r from-brand-400 to-emerald-500'}`} />

      <div className="p-5 flex flex-col flex-1 gap-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-slate-900 text-base capitalize truncate group-hover:text-brand-700 transition-colors">
              {deal.commodity}
            </h3>
            <p className="text-xs text-slate-400 font-mono mt-0.5">{deal.token_symbol}</p>
          </div>
          <span className={`${sc.cls} flex-shrink-0`}>
            <span className={`w-1.5 h-1.5 rounded-full ${sc.dot} inline-block mr-1`} />
            {deal.status}
          </span>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Total Value</p>
            <p className="font-bold text-slate-900 text-sm mt-0.5">${Number(deal.total_value).toLocaleString()}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Quantity</p>
            <p className="font-bold text-slate-900 text-sm mt-0.5">{Number(deal.quantity).toLocaleString()} {deal.quantity_unit}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Tokens Left</p>
            <p className="font-bold text-slate-900 text-sm mt-0.5">{tokensLeft.toLocaleString()}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Delivery</p>
            <p className="font-bold text-slate-900 text-sm mt-0.5">
              {daysLeft > 0 ? `${daysLeft}d left` : new Date(deal.delivery_date).toLocaleDateString('en', { month: 'short', year: '2-digit' })}
            </p>
          </div>
        </div>

        {/* Progress */}
        <div className="mt-auto space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-500 font-medium">
              ${Number(deal.total_invested).toLocaleString()} raised
            </span>
            <span className={`font-bold ${pct >= 100 ? 'text-blue-600' : 'text-brand-600'}`}>
              {pct.toFixed(1)}%
            </span>
          </div>
          <div className="progress-track">
            <div className={pct >= 100 ? 'progress-blue' : 'progress-green'}
              style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[10px] text-slate-400">
            of ${Number(deal.total_value).toLocaleString()} goal
          </p>
        </div>
      </div>

      {/* Footer CTA */}
      <div className="px-5 pb-5">
        <div className="w-full py-2.5 rounded-xl bg-brand-50 text-brand-700 text-xs font-semibold text-center
                        group-hover:bg-brand-600 group-hover:text-white transition-all duration-200">
          View Deal →
        </div>
      </div>
    </Link>
  );
}

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
