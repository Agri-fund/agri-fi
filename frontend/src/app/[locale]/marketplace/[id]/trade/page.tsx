import { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDealById } from '@/lib/api';
import ErrorBoundary from '@/components/ErrorBoundary';
import StatusBadge from '@/components/StatusBadge';
import TradePanel from '@/components/marketplace/TradePanel';

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  try {
    const deal = await getDealById(params.id);
    if (!deal) return { title: 'Deal Not Found | AgriFi' };
    const commodity = deal.commodity.charAt(0).toUpperCase() + deal.commodity.slice(1);
    return { title: `Trade ${commodity} (${deal.token_symbol}) | AgriFi` };
  } catch {
    return { title: 'Trade | AgriFi' };
  }
}

/**
 * Issue #270 — Secondary market trading tab: order book, buy/sell offer
 * forms, and a price history placeholder for a deal's Stellar DEX token.
 */
export default async function TradePage({ params }: { params: { id: string } }) {
  let deal: Awaited<ReturnType<typeof getDealById>> = null;
  try {
    deal = await getDealById(params.id);
  } catch {
    notFound();
  }
  if (!deal) notFound();

  return (
    <ErrorBoundary>
      <nav className="glass sticky top-0 z-20 border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
          <Link
            href={`/marketplace/${deal.id}`}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to deal
          </Link>
          <Link href="/" className="flex items-center gap-2 font-black text-slate-900">
            <span className="text-xl">🌾</span> AgriFi
          </Link>
          <div className="w-24" />
        </div>
      </nav>

      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="max-w-6xl mx-auto space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-black text-slate-900 capitalize tracking-tight">
                Trade {deal.commodity}
              </h1>
              <p className="text-slate-400 font-mono text-sm mt-1">{deal.token_symbol}</p>
            </div>
            <StatusBadge status={deal.status} />
          </div>

          <TradePanel deal={deal} />
        </div>
      </main>
    </ErrorBoundary>
  );
}
