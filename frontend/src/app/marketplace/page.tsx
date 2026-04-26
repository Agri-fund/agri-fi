'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getOpenDeals, Deal } from '@/lib/api';
import FundingProgressBar from '@/components/FundingProgressBar';
import FilterSidebar from '@/components/marketplace/FilterSidebar';

const LIMIT = 12;

export default function MarketplacePage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getOpenDeals(page, LIMIT)
      .then((res) => {
        setDeals(res.data.filter((d) => d.status === 'open'));
        setTotal(res.total);
      })
      .catch(() => setDeals([]))
      .finally(() => setLoading(false));
  }, [page]);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <main className="min-h-screen bg-green-50 px-4 py-10">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-green-800 mb-2">Trade Deal Marketplace</h1>
        <p className="text-green-600 mb-8">Browse open agricultural trade deals available for investment.</p>

        {loading ? (
          <div className="text-center py-24 text-gray-400">Loading...</div>
        ) : deals.length === 0 ? (
          <div className="text-center py-24 text-gray-400">
            <p className="text-xl">No open deals at the moment.</p>
            <p className="text-sm mt-2">Check back soon for new opportunities.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {deals.map((deal) => (
              <Link
                key={deal.id}
                href={`/marketplace/${deal.id}`}
                className="bg-white rounded-2xl shadow-sm border border-green-100 p-5 hover:shadow-md transition-shadow flex flex-col gap-3"
              >
                <div className="flex items-start justify-between">
                  <h2 className="text-lg font-semibold text-gray-800 capitalize">{deal.commodity}</h2>
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Open</span>
                </div>

                <div className="text-sm text-gray-500 space-y-1">
                  <p>Quantity: <span className="text-gray-700 font-medium">{Number(deal.quantity).toLocaleString()} {deal.quantity_unit}</span></p>
                  <p>Total Value: <span className="text-gray-700 font-medium">${Number(deal.total_value).toLocaleString()}</span></p>
                  <p>Delivery: <span className="text-gray-700 font-medium">{new Date(deal.delivery_date).toLocaleDateString()}</span></p>
                </div>

                <FundingProgressBar totalValue={Number(deal.total_value)} totalInvested={Number(deal.total_invested)} />
              </Link>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 mt-10">
            <button
              onClick={() => setPage((p) => p - 1)}
              disabled={page === 1}
              className="px-4 py-2 rounded-md bg-white border border-green-200 text-green-700 font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-green-50 transition-colors"
            >
              Previous
            </button>
            <span className="text-sm text-gray-600">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page === totalPages}
              className="px-4 py-2 rounded-md bg-white border border-green-200 text-green-700 font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-green-50 transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
