'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { getOpenDeals, Deal } from '@/lib/api';
import MarketplaceSkeleton from '@/components/marketplace/MarketplaceSkeleton';
import Pagination from '@/components/ui/Pagination';

const LIMIT = 12;
const SEARCH_DEBOUNCE_MS = 300;
const SESSION_KEY = 'marketplace.filters.v1';

const COMMODITIES = ['maize', 'wheat', 'coffee', 'cocoa', 'rice', 'soybean'];
const DURATION_OPTIONS = ['<3 months', '3-6 months', '6-12 months', '>12 months'] as const;
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'highest_roi', label: 'Highest ROI' },
  { value: 'closing_soon', label: 'Closing soon' },
  { value: 'most_funded', label: 'Most funded' },
] as const;
const STATUS_OPTIONS = ['open', 'almost funded', 'fully funded'] as const;
const RISK_OPTIONS = ['Low', 'Medium', 'High'] as const;

interface Filters {
  q: string;
  commodity: string[];
  country: string;
  region: string;
  minAmount: number;
  maxAmount: number;
  minRoi: number;
  maxRoi: number;
  duration: string;
  riskRating: string;
  status: string;
  sortBy: string;
}

const DEFAULT_FILTERS: Filters = {
  q: '',
  commodity: [],
  country: '',
  region: '',
  minAmount: 0,
  maxAmount: 5000,
  minRoi: 0,
  maxRoi: 100,
  duration: '',
  riskRating: '',
  status: '',
  sortBy: 'newest',
};

function parsePage(raw: string | null): number {
  const page = Number.parseInt(raw ?? '1', 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function parseFilters(params: URLSearchParams): Filters {
  const commodity = params.get('commodity')?.split(',').map((item) => item.trim()).filter(Boolean) ?? [];
  return {
    q: params.get('q') ?? '',
    commodity,
    country: params.get('country') ?? '',
    region: params.get('region') ?? '',
    minAmount: Number(params.get('minAmount') ?? DEFAULT_FILTERS.minAmount),
    maxAmount: Number(params.get('maxAmount') ?? DEFAULT_FILTERS.maxAmount),
    minRoi: Number(params.get('minRoi') ?? DEFAULT_FILTERS.minRoi),
    maxRoi: Number(params.get('maxRoi') ?? DEFAULT_FILTERS.maxRoi),
    duration: params.get('duration') ?? '',
    riskRating: params.get('riskRating') ?? '',
    status: params.get('status') ?? '',
    sortBy: params.get('sortBy') ?? 'newest',
  };
}

function buildQuery(filters: Filters, page: number): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.commodity.length > 0) params.set('commodity', filters.commodity.join(','));
  if (filters.country) params.set('country', filters.country);
  if (filters.region) params.set('region', filters.region);
  if (filters.minAmount > 0) params.set('minAmount', String(filters.minAmount));
  if (filters.maxAmount < DEFAULT_FILTERS.maxAmount) params.set('maxAmount', String(filters.maxAmount));
  if (filters.minRoi > 0) params.set('minRoi', String(filters.minRoi));
  if (filters.maxRoi < DEFAULT_FILTERS.maxRoi) params.set('maxRoi', String(filters.maxRoi));
  if (filters.duration) params.set('duration', filters.duration);
  if (filters.riskRating) params.set('riskRating', filters.riskRating);
  if (filters.status) params.set('status', filters.status);
  if (filters.sortBy && filters.sortBy !== 'newest') params.set('sortBy', filters.sortBy);
  if (page > 1) params.set('page', String(page));
  return params.toString();
}

function highlight(text: string, query: string) {
  if (!query.trim()) return text;
  const needle = query.trim().toLowerCase();
  const idx = text.toLowerCase().indexOf(needle);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded px-1 bg-amber-200 text-slate-900">{text.slice(idx, idx + needle.length)}</mark>
      {text.slice(idx + needle.length)}
    </>
  );
}

function fundingLabel(status?: string | null) {
  if (status === 'fully funded') return 'Fully Funded';
  if (status === 'almost funded') return 'Almost Funded';
  return 'Open';
}

function statusClass(status?: string | null) {
  if (status === 'fully funded') return 'badge-blue';
  if (status === 'almost funded') return 'badge-yellow';
  return 'badge-green';
}

function DealCard({ deal, query }: { deal: Deal; query: string }) {
  const pct = deal.total_value > 0 ? Math.min((Number(deal.total_invested) / Number(deal.total_value)) * 100, 100) : 0;
  const tokensLeft = Math.max(0, Number(deal.token_count) - Math.floor(Number(deal.total_invested) / 100));
  const daysLeft = Math.max(0, Math.ceil((new Date(deal.delivery_date).getTime() - Date.now()) / 86400000));
  const title = deal.title || deal.commodity;
  const summary = deal.short_description || `${deal.commodity} deal`;

  return (
    <Link href={`/marketplace/${deal.id}`} className="card-interactive flex flex-col overflow-hidden group">
      <div className={`h-1.5 w-full ${pct >= 100 ? 'bg-gradient-to-r from-blue-400 to-indigo-500' : 'bg-gradient-to-r from-emerald-400 to-lime-500'}`} />
      <div className="p-5 flex flex-col flex-1 gap-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-slate-900 text-base truncate group-hover:text-emerald-700 transition-colors">
              {highlight(title, query)}
            </h3>
            <p className="text-xs text-slate-400 font-mono mt-0.5">{deal.token_symbol}</p>
          </div>
          <span className={`${statusClass(deal.funding_status)} flex-shrink-0`}>
            {fundingLabel(deal.funding_status)}
          </span>
        </div>

        <p className="text-sm text-slate-600 line-clamp-3">
          {highlight(summary, query)}
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Stat label="Country" value={deal.country || 'Global'} />
          <Stat label="ROI" value={deal.expected_roi ? `${deal.expected_roi}%` : 'N/A'} />
          <Stat label="Min. lot" value={`$${Number(deal.min_investment_lot ?? 0).toLocaleString()}`} />
          <Stat label="Delivery" value={daysLeft > 0 ? `${daysLeft}d left` : 'Closing'} />
        </div>

        <div className="mt-auto space-y-1.5">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-500 font-medium">${Number(deal.total_invested).toLocaleString()} raised</span>
            <span className="font-bold text-emerald-600">{pct.toFixed(1)}%</span>
          </div>
          <div className="progress-track">
            <div className={pct >= 100 ? 'progress-blue' : 'progress-green'} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[10px] text-slate-400">{tokensLeft.toLocaleString()} tokens remaining</p>
        </div>
      </div>

      <div className="px-5 pb-5">
        <div className="w-full py-2.5 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-semibold text-center group-hover:bg-emerald-600 group-hover:text-white transition-all duration-200">
          View Deal →
        </div>
      </div>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-xl p-3">
      <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">{label}</p>
      <p className="font-bold text-slate-900 text-sm mt-0.5">{value}</p>
    </div>
  );
}

function MarketplaceContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const initialPage = parsePage(searchParams.get('page'));
  const initialFilters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const [page, setPage] = useState(initialPage);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [searchInput, setSearchInput] = useState(initialFilters.q);
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
    const params = {
      commodity: filters.commodity.length > 0 ? filters.commodity.join(',') : undefined,
      country: filters.country || undefined,
      minAmount: filters.minAmount > 0 ? filters.minAmount : undefined,
      maxAmount: filters.maxAmount < DEFAULT_FILTERS.maxAmount ? filters.maxAmount : undefined,
      minRoi: filters.minRoi > 0 ? filters.minRoi : undefined,
      maxRoi: filters.maxRoi < DEFAULT_FILTERS.maxRoi ? filters.maxRoi : undefined,
      duration: filters.duration || undefined,
      riskRating: filters.riskRating || undefined,
      status: filters.status || undefined,
      sortBy: filters.sortBy || undefined,
      q: filters.q || undefined,
    };

    getOpenDeals(page, LIMIT, params)
      .then((res) => {
        if (!active) return;
        setDeals(res.data);
        setTotal(res.total);
      })
      .catch(() => {
        if (active) setDeals([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

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
          <button className="btn-secondary lg:hidden" onClick={() => setFiltersOpen((current) => !current)}>
            {filtersOpen ? 'Hide filters' : 'Show filters'}
          </button>
          <button className="btn-secondary hidden lg:inline-flex" onClick={clearAll}>
            Clear all filters
          </button>
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
