import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDealById, Milestone } from '@/lib/api';
import FundingProgressBar from '@/components/FundingProgressBar';
import StatusBadge from '@/components/StatusBadge';
import { ShipmentTimeline } from '@/components/ShipmentTimeline';
import ErrorBoundary from '@/components/ErrorBoundary';
import InvestmentSection from '@/components/InvestmentSection';

// Render this route on demand. Avoids build-time fetches against a backend
// that is not reachable from the CI build environment.
export const dynamic = 'force-dynamic';
export const revalidate = 60;

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  let deal: Awaited<ReturnType<typeof getDealById>> = null;
  try {
    deal = await getDealById(params.id);
  } catch {
    // Backend unreachable (e.g. during CI build) — fall back to a generic title.
    return { title: 'Trade Deal | Agri-Fi' };
  }
  if (!deal) return { title: 'Deal Not Found' };

  const title = `${deal.commodity.charAt(0).toUpperCase() + deal.commodity.slice(1)} Trade Deal | Agri-Fi`;
  const description = `Investment opportunity: ${deal.commodity} trade deal with a total value of $${Number(deal.total_value).toLocaleString()}. ${deal.quantity} ${deal.quantity_unit} available for funding.`;
  const ogImageUrl = `/api/trade-deals/${params.id}/og?commodity=${encodeURIComponent(deal.commodity)}&value=${encodeURIComponent(Number(deal.total_value).toLocaleString())}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: `${deal.commodity} Trade Deal`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

const MILESTONE_ORDER = ['farm', 'warehouse', 'port', 'importer'];

export default async function DealDetailPage({ params }: { params: { id: string } }) {
  let deal: Awaited<ReturnType<typeof getDealById>> = null;
  try {
    deal = await getDealById(params.id);
  } catch {
    // Backend unreachable — render the not-found page rather than crashing the build.
    notFound();
  }
  if (!deal) notFound();

  const getMilestoneIndex = (m: Milestone) => {
    const i = MILESTONE_ORDER.indexOf(m.milestone as string);
    return i === -1 ? 999 : i;
  };

  const milestones = [...(deal.milestones ?? [])].sort(
    (a, b) => getMilestoneIndex(a) - getMilestoneIndex(b)
  );

  return (
    <ErrorBoundary>
      <main className="min-h-screen bg-green-50 px-4 py-10">
        <div className="max-w-3xl mx-auto space-y-8">

          {/* Header */}
          <div className="bg-white rounded-2xl shadow-sm border border-green-100 p-6 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h1 className="text-2xl font-bold text-gray-800 capitalize">{deal.commodity}</h1>
              <StatusBadge status={deal.status} />
            </div>

            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm text-gray-500">
              <p>Quantity: <span className="text-gray-800 font-medium">{Number(deal.quantity).toLocaleString()} {deal.quantity_unit}</span></p>
              <p>Total Value: <span className="text-gray-800 font-medium">${Number(deal.total_value).toLocaleString()}</span></p>
              <p>Delivery Date: <span className="text-gray-800 font-medium">{new Date(deal.delivery_date).toLocaleDateString()}</span></p>
              <p>Token: <span className="text-gray-800 font-medium">{deal.token_symbol}</span></p>
            </div>

            <FundingProgressBar totalValue={Number(deal.total_value)} totalInvested={Number(deal.total_invested)} />

            <InvestmentSection deal={deal} />
          </div>

          {/* Documents */}
          <section className="bg-white rounded-2xl shadow-sm border border-green-100 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Documents</h2>
            {!deal.documents || deal.documents.length === 0 ? (
              <p className="text-sm text-gray-400">No documents uploaded yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {deal.documents.map((doc) => (
                  <li key={doc.id} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                    <div>
                      <span className="text-sm font-medium text-gray-700 capitalize">{doc.doc_type.replace(/_/g, ' ')}</span>
                      <p className="text-xs text-gray-400">{new Date(doc.created_at).toLocaleDateString()}</p>
                    </div>
                    <a
                      href={`https://ipfs.io/ipfs/${doc.ipfs_hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-green-600 hover:underline break-all"
                    >
                      {doc.ipfs_hash}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Milestones */}
          <section className="bg-white rounded-2xl shadow-sm border border-green-100 p-6">
            <ShipmentTimeline tradeDealId={deal.id} initialMilestones={milestones} />
          </section>

        </div>
      </main>
    </ErrorBoundary>
  );
}
