import { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDealById, Milestone } from '@/lib/api';
import FundingProgressBar from '@/components/FundingProgressBar';
import StatusBadge from '@/components/StatusBadge';
import { ShipmentTimeline } from '@/components/ShipmentTimeline';
import ErrorBoundary from '@/components/ErrorBoundary';
import InvestmentSection from '@/components/InvestmentSection';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  try {
    const deal = await getDealById(params.id);
    if (!deal) return { title: 'Deal Not Found | AgriFi' };
    const title = `${deal.commodity.charAt(0).toUpperCase() + deal.commodity.slice(1)} — AgriFi`;
    const description = `${deal.quantity} ${deal.quantity_unit} of ${deal.commodity}. Total value $${Number(deal.total_value).toLocaleString()}.`;
    return { title, description };
  } catch {
    return { title: 'Trade Deal | AgriFi' };
  }
}

const MILESTONE_ORDER = ['farm', 'warehouse', 'port', 'importer'];

export default async function DealDetailPage({ params }: { params: { id: string } }) {
  let deal: Awaited<ReturnType<typeof getDealById>> = null;
  try { deal = await getDealById(params.id); } catch { notFound(); }
  if (!deal) notFound();

  const milestones = [...(deal.milestones ?? [])].sort((a, b) => {
    const ai = MILESTONE_ORDER.indexOf(a.milestone as string);
    const bi = MILESTONE_ORDER.indexOf(b.milestone as string);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const pct = deal.total_value > 0
    ? Math.min((Number(deal.total_invested) / Number(deal.total_value)) * 100, 100) : 0;

  return (
    <ErrorBoundary>
      {/* Navbar */}
      <nav className="glass sticky top-0 z-20 border-b border-slate-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
          <Link href="/marketplace" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
            </svg>
            Marketplace
          </Link>
          <Link href="/" className="flex items-center gap-2 font-black text-slate-900">
            <span className="text-xl">🌾</span> AgriFi
          </Link>
          <div className="w-24" /> {/* spacer */}
        </div>
      </nav>

      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-5">

          {/* Hero card */}
          <div className="card overflow-hidden">
            {/* Progress bar top accent */}
            <div className="h-1.5 bg-slate-100">
              <div className="h-full bg-gradient-to-r from-brand-400 to-emerald-500 transition-all duration-700"
                style={{ width: `${pct}%` }} />
            </div>

            <div className="p-6 sm:p-8">
              <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                  <h1 className="text-3xl font-black text-slate-900 capitalize tracking-tight">{deal.commodity}</h1>
                  <p className="text-slate-400 font-mono text-sm mt-1">{deal.token_symbol}</p>
                </div>
                <StatusBadge status={deal.status} />
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                {[
                  { label: 'Quantity',     value: `${Number(deal.quantity).toLocaleString()} ${deal.quantity_unit}` },
                  { label: 'Total Value',  value: `$${Number(deal.total_value).toLocaleString()}` },
                  { label: 'Token Price',  value: `$${(Number(deal.total_value) / Number(deal.token_count)).toFixed(0)}` },
                  { label: 'Delivery',     value: new Date(deal.delivery_date).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }) },
                ].map(s => (
                  <div key={s.label} className="bg-slate-50 rounded-2xl p-4">
                    <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">{s.label}</p>
                    <p className="font-bold text-slate-900 mt-1">{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Funding progress */}
              <FundingProgressBar
                totalValue={Number(deal.total_value)}
                totalInvested={Number(deal.total_invested)}
              />

              {/* Tokens remaining */}
              {deal.tokens_remaining > 0 && (
                <p className="text-xs text-slate-400 mt-2">
                  <span className="font-semibold text-slate-600">{deal.tokens_remaining.toLocaleString()}</span> tokens remaining
                </p>
              )}

              {/* Investment CTA */}
              <InvestmentSection deal={deal} />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-5">
            {/* Documents */}
            <div className="card p-6">
              <h2 className="section-title mb-4">Documents</h2>
              {!deal.documents || deal.documents.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-3xl mb-2">📄</p>
                  <p className="text-sm text-slate-400">No documents uploaded yet</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {deal.documents.map(doc => (
                    <li key={doc.id} className="py-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900 capitalize">
                          {doc.doc_type.replace(/_/g, ' ')}
                        </p>
                        <p className="text-xs text-slate-400">{new Date(doc.created_at).toLocaleDateString()}</p>
                      </div>
                      <a href={`https://ipfs.io/ipfs/${doc.ipfs_hash}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-xs text-brand-600 hover:underline font-mono truncate max-w-[120px]">
                        {doc.ipfs_hash.slice(0, 12)}…
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Milestones */}
            <div className="card p-6">
              <ShipmentTimeline tradeDealId={deal.id} initialMilestones={milestones} />
            </div>
          </div>

        </div>
      </main>
    </ErrorBoundary>
  );
}
