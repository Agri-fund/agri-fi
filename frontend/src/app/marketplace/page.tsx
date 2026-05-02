'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getOpenDeals, Deal } from '@/lib/api';

const LIMIT = 12;

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

function SkeletonCard() {
  return (
    <div className="card overflow-hidden">
      <div className="h-1.5 skeleton" />
      <div className="p-5 space-y-4">
        <div className="flex justify-between">
          <div className="skeleton h-5 w-32 rounded-lg" />
          <div className="skeleton h-5 w-16 rounded-full" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="skeleton h-14 rounded-xl" />)}
        </div>
        <div className="skeleton h-8 rounded-xl" />
        <div className="skeleton h-9 rounded-xl" />
      </div>
    </div>
  );
}

export default function MarketplacePage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    getOpenDeals(page, LIMIT)
      .then(res => { setDeals(res.data); setTotal(res.total); })
      .catch(() => setDeals([]))
      .finally(() => setLoading(false));
  }, [page]);

  const filtered = search
    ? deals.filter(d => d.commodity.toLowerCase().includes(search.toLowerCase()))
    : deals;

  const totalPages = Math.ceil(total / LIMIT);

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

        {/* Search + filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          <div className="relative flex-1 max-w-md">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
              </svg>
            </span>
            <input className="input pl-10" placeholder="Search by commodity…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {search && (
            <button onClick={() => setSearch('')} className="btn-secondary text-sm px-4">
              Clear ×
            </button>
          )}
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="card p-16 text-center">
            <p className="text-5xl mb-4">🌾</p>
            <h3 className="font-bold text-slate-900 text-xl mb-2">No deals found</h3>
            <p className="text-slate-500">
              {search ? `No results for "${search}"` : 'Check back soon for new opportunities'}
            </p>
            {search && (
              <button onClick={() => setSearch('')} className="btn-primary mt-4 mx-auto">
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {filtered.map(deal => <DealCard key={deal.id} deal={deal} />)}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-2 mt-12">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
              className="btn-secondary px-4 py-2 disabled:opacity-40">
              ← Prev
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => (
                <button key={p} onClick={() => setPage(p)}
                  className={`w-9 h-9 rounded-xl text-sm font-semibold transition-all ${
                    p === page ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                  }`}>
                  {p}
                </button>
              ))}
            </div>
            <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)}
              className="btn-secondary px-4 py-2 disabled:opacity-40">
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
