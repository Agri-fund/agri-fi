'use client';

import { useEffect, useState } from 'react';

interface Offer {
  offerId: string;
  buyer: string;
  amount: string;
  price: string;
}

interface OrderBookProps {
  tradeTokenCode: string;
  tradeTokenIssuer: string;
}

/**
 * Issue #112 — Secondary Market: Active buy offers for a trade token.
 * Displays the DEX buy order book so sellers can see current bids.
 *
 * Security: authentication is checked BEFORE the fetch is initiated.
 * This prevents the token issuer public key from being sent to the backend
 * without a valid session, keeping the Stellar DEX querying surface private.
 */
export const OrderBook: React.FC<OrderBookProps> = ({
  tradeTokenCode,
  tradeTokenIssuer,
}) => {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    // Resolve auth state client-side (localStorage is not available during SSR).
    const token =
      typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;

    setIsAuthenticated(!!token);

    // Do NOT proceed with the fetch when there is no valid session.
    // This ensures the token issuer public key is never included in an
    // unauthenticated request to the backend.
    if (!token) return;
    if (!tradeTokenCode || !tradeTokenIssuer) return;

    setIsLoading(true);

    fetch(
      `/api/investments/buy-orders/${encodeURIComponent(tradeTokenCode)}/${encodeURIComponent(tradeTokenIssuer)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    )
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load offers');
        return res.json() as Promise<Offer[]>;
      })
      .then(setOffers)
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : 'Could not load order book';
        setError(message);
      })
      .finally(() => setIsLoading(false));
  }, [tradeTokenCode, tradeTokenIssuer]);

  const truncate = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

  // ── Unauthenticated state ─────────────────────────────────────────────────
  if (isAuthenticated === false) {
    return (
      <section
        className="bg-white rounded-2xl shadow-sm border border-green-100 p-6"
        data-testid="order-book-login-prompt"
      >
        <h2 className="text-lg font-semibold text-gray-800 mb-1">
          Secondary Market — Active Buy Orders
        </h2>
        <p className="text-xs text-gray-400 mb-6">
          Stellar DEX bids for{' '}
          <span className="font-mono">{tradeTokenCode}</span>
        </p>

        <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
          {/* Lock icon */}
          <svg
            className="w-10 h-10 text-green-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>

          <p className="text-sm font-medium text-gray-700">
            Connect wallet to view order book
          </p>
          <p className="text-xs text-gray-400 max-w-xs">
            You must be signed in to access the secondary market order book.
          </p>
        </div>
      </section>
    );
  }

  // ── Authenticated state ───────────────────────────────────────────────────
  return (
    <section
      className="bg-white rounded-2xl shadow-sm border border-green-100 p-6"
      data-testid="order-book"
    >
      <h2 className="text-lg font-semibold text-gray-800 mb-1">
        Secondary Market — Active Buy Orders
      </h2>
      <p className="text-xs text-gray-400 mb-4">
        Stellar DEX bids for{' '}
        <span className="font-mono">{tradeTokenCode}</span>
      </p>

      {/* Loading indicator shown only while the authenticated fetch is in flight */}
      {isLoading && (
        <p className="text-sm text-gray-400 animate-pulse">
          Loading order book…
        </p>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {!isLoading && !error && offers.length === 0 && (
        <p className="text-sm text-gray-400">
          No active buy orders for this token.
        </p>
      )}

      {offers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="pb-2 pr-4 font-medium">Buyer</th>
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
                      {truncate(offer.buyer)}
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
