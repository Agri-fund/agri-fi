'use client';

import { useEffect, useState } from 'react';

interface Offer {
  offerId: string;
  seller: string;
  amount: string;
  price: string;
}

interface OrderBookProps {
  tradeTokenCode: string;
  tradeTokenIssuer: string;
}

/**
 * Issue #88 — Secondary Market: Active sell offers for a trade token.
 * Displays the DEX order book so buyers can see available listings.
 */
export const OrderBook: React.FC<OrderBookProps> = ({
  tradeTokenCode,
  tradeTokenIssuer,
}) => {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tradeTokenCode || !tradeTokenIssuer) return;

    const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;

    fetch(
      `/api/investments/offers/${encodeURIComponent(tradeTokenCode)}/${encodeURIComponent(tradeTokenIssuer)}`,
      {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
    )
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load offers');
        return res.json() as Promise<Offer[]>;
      })
      .then(setOffers)
      .catch((err) => setError(err.message ?? 'Could not load order book'))
      .finally(() => setIsLoading(false));
  }, [tradeTokenCode, tradeTokenIssuer]);

  const truncate = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-green-100 p-6">
      <h2 className="text-lg font-semibold text-gray-800 mb-1">
        Secondary Market — Active Sell Orders
      </h2>
      <p className="text-xs text-gray-400 mb-4">
        Stellar DEX listings for <span className="font-mono">{tradeTokenCode}</span>
      </p>

      {isLoading && (
        <p className="text-sm text-gray-400 animate-pulse">Loading order book…</p>
      )}

      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      {!isLoading && !error && offers.length === 0 && (
        <p className="text-sm text-gray-400">No active sell orders for this token.</p>
      )}

      {offers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="pb-2 pr-4 font-medium">Seller</th>
                <th className="pb-2 pr-4 font-medium">Amount</th>
                <th className="pb-2 pr-4 font-medium">Price (USDC)</th>
                <th className="pb-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {offers.map((offer) => {
                const total = (
                  parseFloat(offer.amount) * parseFloat(offer.price)
                ).toFixed(2);
                return (
                  <tr key={offer.offerId} className="hover:bg-gray-50">
                    <td className="py-2 pr-4 font-mono text-xs text-gray-600">
                      {truncate(offer.seller)}
                    </td>
                    <td className="py-2 pr-4 text-gray-800">{offer.amount}</td>
                    <td className="py-2 pr-4 text-gray-800">{offer.price}</td>
                    <td className="py-2 text-gray-800">{total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
