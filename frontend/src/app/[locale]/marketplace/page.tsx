'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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

const SORT_OPTIONS = [
  { value: 'created_at', label: 'Launch Date' },
  { value: 'roi', label: 'Yield Rate' },
  { value: 'total_value', label: 'Total Value' },
  { value: 'progress', label: 'Progress' },
] as const;

function MarketplaceContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlPage = parsePageParam(searchParams.get('page'));
  const urlSearch = searchParams.get('q') ?? '';
  const urlSortBy = searchParams.get('sortBy') ?? 'created_at';
  const urlSortOrder = (searchParams.get('sortOrder') ?? 'DESC') as 'ASC' | 'DESC';

  const [deals, setDeals] = useState<Deal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    const hasUrlFilters = searchParams.toString().length > 0;
    if (!hasUrlFilters && typeof window !== 'undefined') {
      try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as { filters?: Filters; page?: number };
          if (saved.filters) setFilters(saved.filters);
          if (saved.page) setPage(saved.page);
          if (saved.filters?.q) setSearchInput(saved.filters.q);
        }
      } catch {
        // Ignore corrupt session state.
      }
    }
  }, [searchParams]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      setFilters((current) => ({ ...current, q: searchInput }));
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const query = buildQuery(filters, page);
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ filters, page }));
    } catch {
      // Session persistence is best-effort.
    }
  }, [filters, page, hydrated, pathname, router]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getOpenDeals(urlPage, LIMIT, urlSortBy, urlSortOrder)
      .then((res) => {
        if (!active) return;
        setDeals(res.data);
        setTotal(res.total);
      })
      .catch(() => setDeals([]))
      .finally(() => setLoading(false));
  }, [urlPage, urlSortBy, urlSortOrder]);

    return () => {
      active = false;
    };
  }, [filters, page]);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const activeChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];
    filters.commodity.forEach((commodity) => {
      chips.push({
        key: `commodity-${commodity}`,
        label: commodity,
        onRemove: () =>
          setFilters((current) => ({ ...current, commodity: current.commodity.filter((item) => item !== commodity) })),
      });
    });
    if (filters.q) chips.push({ key: 'q', label: `Search: ${filters.q}`, onRemove: () => setSearchInput('') });
    if (filters.country) chips.push({ key: 'country', label: filters.country, onRemove: () => setFilters((c) => ({ ...c, country: '' })) });
    if (filters.region) chips.push({ key: 'region', label: filters.region, onRemove: () => setFilters((c) => ({ ...c, region: '' })) });
    if (filters.duration) chips.push({ key: 'duration', label: filters.duration, onRemove: () => setFilters((c) => ({ ...c, duration: '' })) });
    if (filters.riskRating) chips.push({ key: 'riskRating', label: filters.riskRating, onRemove: () => setFilters((c) => ({ ...c, riskRating: '' })) });
    if (filters.status) chips.push({ key: 'status', label: filters.status, onRemove: () => setFilters((c) => ({ ...c, status: '' })) });
    if (filters.sortBy && filters.sortBy !== 'newest') chips.push({ key: 'sortBy', label: filters.sortBy.replace('_', ' '), onRemove: () => setFilters((c) => ({ ...c, sortBy: 'newest' })) });
    if (filters.minAmount > 0) chips.push({ key: 'minAmount', label: `Min $${filters.minAmount}`, onRemove: () => setFilters((c) => ({ ...c, minAmount: 0 })) });
    if (filters.maxAmount < DEFAULT_FILTERS.maxAmount) chips.push({ key: 'maxAmount', label: `Max $${filters.maxAmount}`, onRemove: () => setFilters((c) => ({ ...c, maxAmount: DEFAULT_FILTERS.maxAmount })) });
    if (filters.minRoi > 0) chips.push({ key: 'minRoi', label: `Min ROI ${filters.minRoi}%`, onRemove: () => setFilters((c) => ({ ...c, minRoi: 0 })) });
    if (filters.maxRoi < DEFAULT_FILTERS.maxRoi) chips.push({ key: 'maxRoi', label: `Max ROI ${filters.maxRoi}%`, onRemove: () => setFilters((c) => ({ ...c, maxRoi: DEFAULT_FILTERS.maxRoi })) });
    return chips;
  }, [filters]);

  const clearAll = () => {
    setSearchInput('');
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  };

  const toggleCommodity = (commodity: string) => {
    setFilters((current) => ({
      ...current,
      commodity: current.commodity.includes(commodity)
        ? current.commodity.filter((item) => item !== commodity)
        : [...current.commodity, commodity],
    }));
    setPage(1);
  };

  const handleSortChange = (sortBy: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('sortBy', sortBy);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const toggleSortOrder = () => {
    const newOrder = urlSortOrder === 'ASC' ? 'DESC' : 'ASC';
    const params = new URLSearchParams(searchParams.toString());
    params.set('sortOrder', newOrder);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="glass sticky top-0 z-20 border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-14">
          <Link href="/" className="flex items-center gap-2 font-black text-slate-900">
            <span className="text-xl">🌾</span> AgriFi
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn-secondary text-sm px-4 py-2">Sign in</Link>
            <Link href="/register" className="btn-primary text-sm px-4 py-2">Get Started</Link>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <span className="badge-green">Live</span>
            <span className="text-xs text-slate-400">{total} open deal{total !== 1 ? 's' : ''}</span>
          </div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight mb-2">Marketplace</h1>
          <p className="text-slate-500 text-lg">Browse open agricultural investment opportunities</p>
        </div>

        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1 max-w-2xl">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </span>
            <input
              className="input pl-10"
              placeholder="Search deals..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Search deals"
            />
          </div>
          
          {/* Sort dropdown */}
          <div className="relative">
            <select
              className="input pr-8 appearance-none cursor-pointer"
              value={urlSortBy}
              onChange={(e) => handleSortChange(e.target.value)}
              aria-label="Sort deals by"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </span>
          </div>

          {/* Sort order toggle */}
          <button
            onClick={toggleSortOrder}
            className="btn-secondary text-sm px-4 flex items-center gap-2"
            aria-label={`Sort ${urlSortOrder === 'ASC' ? 'ascending' : 'descending'}`}
          >
            {urlSortOrder === 'ASC' ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4" />
              </svg>
            )}
            {urlSortOrder}
          </button>

          {searchInput && (
            <button onClick={clearSearch} className="btn-secondary text-sm px-4">
              Clear ×
            </button>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <aside className={`${filtersOpen ? 'block' : 'hidden'} lg:block rounded-3xl border border-slate-200 bg-white p-5 shadow-sm`}>
            <div className="flex items-center justify-between">
              <h2 className="font-black text-slate-900">Filters</h2>
              <button className="text-sm text-slate-500 hover:text-slate-900" onClick={clearAll}>Reset</button>
            </div>

            <div className="mt-5 space-y-5">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400 mb-3">Commodity</p>
                <div className="flex flex-wrap gap-2">
                  {COMMODITIES.map((commodity) => (
                    <button
                      key={commodity}
                      type="button"
                      onClick={() => toggleCommodity(commodity)}
                      className={`rounded-full px-3 py-2 text-sm font-semibold capitalize border transition ${
                        filters.commodity.includes(commodity)
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {commodity}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3">
                <label className="text-xs uppercase tracking-[0.3em] text-slate-400">Country / region</label>
                <input className="input" placeholder="Country" value={filters.country} onChange={(e) => { setFilters((current) => ({ ...current, country: e.target.value })); setPage(1); }} />
                <input className="input" placeholder="Region" value={filters.region} onChange={(e) => { setFilters((current) => ({ ...current, region: e.target.value })); setPage(1); }} />
              </div>

              <div>
                <label className="text-xs uppercase tracking-[0.3em] text-slate-400">Investment amount</label>
                <div className="mt-3 space-y-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">Minimum</p>
                    <input type="range" min={0} max={5000} step={50} value={filters.minAmount} onChange={(e) => { setFilters((current) => ({ ...current, minAmount: Number(e.target.value) })); setPage(1); }} className="w-full mt-2" />
                    <p className="mt-1 text-sm text-slate-600">${filters.minAmount.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">Maximum</p>
                    <input type="range" min={0} max={5000} step={50} value={filters.maxAmount} onChange={(e) => { setFilters((current) => ({ ...current, maxAmount: Number(e.target.value) })); setPage(1); }} className="w-full mt-2" />
                    <p className="mt-1 text-sm text-slate-600">${filters.maxAmount.toLocaleString()}</p>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs uppercase tracking-[0.3em] text-slate-400">Expected ROI</label>
                <input type="range" min={0} max={100} step={1} value={filters.minRoi} onChange={(e) => { setFilters((current) => ({ ...current, minRoi: Number(e.target.value) })); setPage(1); }} className="w-full mt-3" />
                <p className="mt-1 text-sm text-slate-600">Min {filters.minRoi}%</p>
                <input type="range" min={0} max={100} step={1} value={filters.maxRoi} onChange={(e) => { setFilters((current) => ({ ...current, maxRoi: Number(e.target.value) })); setPage(1); }} className="w-full mt-3" />
                <p className="mt-1 text-sm text-slate-600">Max {filters.maxRoi}%</p>
              </div>

              <div>
                <label className="text-xs uppercase tracking-[0.3em] text-slate-400 mb-3 block">Duration</label>
                <div className="grid gap-2">
                  {DURATION_OPTIONS.map((duration) => (
                    <label key={duration} className="flex items-center gap-2 text-sm text-slate-600">
                      <input type="radio" checked={filters.duration === duration} onChange={() => { setFilters((current) => ({ ...current, duration })); setPage(1); }} />
                      {duration}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid gap-3">
                <select className="input bg-white" value={filters.riskRating} onChange={(e) => { setFilters((current) => ({ ...current, riskRating: e.target.value })); setPage(1); }}>
                  <option value="">Risk rating</option>
                  {RISK_OPTIONS.map((risk) => <option key={risk} value={risk}>{risk}</option>)}
                </select>
                <select className="input bg-white" value={filters.status} onChange={(e) => { setFilters((current) => ({ ...current, status: e.target.value })); setPage(1); }}>
                  <option value="">Funding status</option>
                  {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
                <select className="input bg-white" value={filters.sortBy} onChange={(e) => { setFilters((current) => ({ ...current, sortBy: e.target.value })); setPage(1); }}>
                  {SORT_OPTIONS.map((sort) => <option key={sort.value} value={sort.value}>{sort.label}</option>)}
                </select>
              </div>
            </div>
          </aside>

          <main>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-700">Showing {deals.length} of {total} deals</span>
              {activeChips.map((chip) => (
                <button key={chip.key} onClick={chip.onRemove} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300">
                  {chip.label}
                  <span>×</span>
                </button>
              ))}
              {activeChips.length > 0 && (
                <button onClick={clearAll} className="text-sm font-semibold text-emerald-700">Clear all</button>
              )}
            </div>

            {loading ? (
              <MarketplaceSkeleton count={6} />
            ) : deals.length === 0 ? (
              <div className="card p-16 text-center">
                <p className="text-5xl mb-4">🌾</p>
                <h3 className="font-bold text-slate-900 text-xl mb-2">No deals found</h3>
                <p className="text-slate-500">Try adjusting your filters or search terms.</p>
                <button onClick={clearAll} className="btn-primary mt-4 mx-auto">Clear filters</button>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {deals.map((deal) => (
                  <DealCard key={deal.id} deal={deal} query={filters.q} />
                ))}
              </div>
            )}

            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </main>
        </div>
      </div>
    </div>
  );
}

export default function MarketplacePage() {
  return (
    <Suspense fallback={<MarketplaceSkeleton count={6} />}>
      <MarketplaceContent />
    </Suspense>
  );
}
