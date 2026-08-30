import Link from 'next/link';
import { Deal } from '@/lib/api';

function formatRoi(value: number | null | undefined): string {
  return value == null ? 'Not specified' : `${Number(value).toFixed(1)}%`;
}

function formatDuration(value: number | null | undefined): string {
  return value == null ? 'Not specified' : `${value} days`;
}

function formatProgress(deal: Deal): string {
  const progress = deal.total_value > 0
    ? Math.min((Number(deal.total_invested) / Number(deal.total_value)) * 100, 100)
    : 0;
  return `${progress.toFixed(1)}%`;
}

export default function DealComparison({
  deals,
  onRemove,
  onClear,
}: {
  deals: Deal[];
  onRemove: (dealId: string) => void;
  onClear: () => void;
}) {
  if (deals.length === 0) return null;

  const rows = [
    ['Expected ROI', (deal: Deal) => formatRoi(deal.expected_roi)],
    ['Duration', (deal: Deal) => formatDuration(deal.duration_days)],
    ['Funding progress', (deal: Deal) => formatProgress(deal)],
    ['Risk rating', (deal: Deal) => deal.risk_rating ?? 'Not specified'],
    ['Commodity', (deal: Deal) => deal.commodity],
  ] as const;

  return (
    <section className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 shadow-[0_-8px_30px_rgba(15,23,42,0.12)] backdrop-blur" aria-label="Deal comparison">
      <div className="mx-auto max-w-7xl overflow-x-auto px-4 py-4 sm:px-6 lg:px-8">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="font-bold text-slate-900">Compare deals ({deals.length}/3)</h2>
          <button type="button" onClick={onClear} className="text-sm font-semibold text-slate-500 hover:text-slate-900">
            Clear all
          </button>
        </div>
        <table className="w-full min-w-[640px] table-fixed text-left text-sm">
          <thead>
            <tr>
              <th className="w-36 pb-2 font-semibold text-slate-400">Metric</th>
              {deals.map((deal) => (
                <th key={deal.id} className="pb-2 pr-4 align-top font-semibold text-slate-900">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/marketplace/${deal.id}`} className="capitalize hover:text-brand-700">
                      {deal.commodity}
                    </Link>
                    <button type="button" onClick={() => onRemove(deal.id)} aria-label={`Remove ${deal.commodity} from comparison`} className="text-slate-400 hover:text-slate-900">
                      ×
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label} className="border-t border-slate-100">
                <th className="py-2 font-medium text-slate-500">{label}</th>
                {deals.map((deal) => <td key={deal.id} className="py-2 pr-4 font-semibold text-slate-800">{value(deal)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
