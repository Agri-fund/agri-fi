import Image from 'next/image';
import Link from 'next/link';
import { Deal } from '@/lib/api';

const STATUS_CONFIG: Record<string, { cls: string; dot: string }> = {
  open:      { cls: 'badge-green',  dot: 'bg-emerald-500' },
  funded:    { cls: 'badge-blue',   dot: 'bg-blue-500' },
  draft:     { cls: 'badge-gray',   dot: 'bg-slate-400' },
  delivered: { cls: 'badge-purple', dot: 'bg-violet-500' },
  completed: { cls: 'badge-gray',   dot: 'bg-slate-400' },
  failed:    { cls: 'badge-red',    dot: 'bg-red-500' },
};

// Matches the grid breakpoints the marketplace page renders this card in
// (1 col on mobile, up to 4 on xl) so the browser fetches an appropriately
// sized — not just compressed — image at each viewport.
const CARD_IMAGE_SIZES = '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw';

/**
 * Issue #266 — Commodity cover photo, served through next/image so the
 * browser requests a right-sized, cached webp instead of the original
 * trader upload.
 */
function DealCoverImage({ deal }: { deal: Deal }) {
  if (!deal.cover_image_url) {
    return (
      <div
        className="h-32 w-full flex items-center justify-center bg-gradient-to-br from-brand-50 to-emerald-50 text-4xl"
        aria-hidden="true"
      >
        🌾
      </div>
    );
  }

  return (
    <div className="relative h-32 w-full bg-slate-100">
      <Image
        src={deal.cover_image_url}
        alt={`${deal.commodity} cover photo`}
        fill
        sizes={CARD_IMAGE_SIZES}
        className="object-cover"
      />
    </div>
  );
}

export default function DealCard({
  deal,
  selected = false,
  onToggleCompare,
}: {
  deal: Deal;
  selected?: boolean;
  onToggleCompare?: () => void;
}) {
  const pct = deal.total_value > 0
    ? Math.min((Number(deal.total_invested) / Number(deal.total_value)) * 100, 100) : 0;
  const tokensLeft = Math.max(0, Number(deal.token_count) - Math.floor(Number(deal.total_invested) / 100));
  const sc = STATUS_CONFIG[deal.status] ?? STATUS_CONFIG.draft;
  const daysLeft = Math.max(0, Math.ceil((new Date(deal.delivery_date).getTime() - Date.now()) / 86400000));

  return (
    <div className="relative">
      <Link href={`/marketplace/${deal.id}`}
        className={`card-interactive flex flex-col overflow-hidden group ${selected ? 'ring-2 ring-brand-500 ring-offset-2' : ''}`}>
      <DealCoverImage deal={deal} />

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
      {onToggleCompare && (
        <button
          type="button"
          onClick={onToggleCompare}
          aria-pressed={selected}
          aria-label={`${selected ? 'Remove' : 'Add'} ${deal.commodity} ${selected ? 'from' : 'to'} comparison`}
          className={`absolute right-3 top-3 z-10 rounded-lg border px-2.5 py-1.5 text-xs font-semibold shadow-sm transition-colors ${
            selected
              ? 'border-brand-600 bg-brand-600 text-white'
              : 'border-slate-200 bg-white/95 text-slate-700 hover:border-brand-400 hover:text-brand-700'
          }`}
        >
          {selected ? 'Selected' : 'Compare'}
        </button>
      )}
    </div>
  );
}
