'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { getDealById, Deal, Document as DealDocument } from '@/lib/api';
import { TradeAcronym } from '@/components/ui/Tooltip';
import StatusBadge from '@/components/StatusBadge';
import { InvestmentModal } from './InvestmentModal';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DealDetailsProps {
  dealId: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(value: number | string): string {
  return Number(value).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function fundingPercent(deal: Deal): number {
  const total = Number(deal.total_value);
  if (!total) return 0;
  return Math.min(Math.round((Number(deal.total_invested) / total) * 100), 100);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 border-b border-border last:border-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <span className="text-sm font-medium text-muted-foreground sm:whitespace-nowrap">{label}</span>
      <span className="text-sm font-semibold text-foreground text-left break-words sm:text-right">{value}</span>
    </div>
  );
}

function DocumentRow({ doc }: { doc: DealDocument }) {
  return (
    <a
      href={doc.storage_url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-w-0 items-center gap-3 p-3 rounded-xl border border-border bg-surface hover:bg-primary-muted transition-colors group"
    >
      {/* File icon */}
      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate capitalize group-hover:text-primary transition-colors">
          {doc.doc_type.replace(/_/g, ' ')}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          Uploaded {formatDate(doc.created_at)}
        </p>
      </div>
      <svg className="w-4 h-4 text-muted-foreground group-hover:text-primary flex-shrink-0 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  );
}

// ── Skeleton loader ───────────────────────────────────────────────────────────

function DealDetailsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading deal details">
      <div className="h-8 w-64 skeleton rounded" />
      <div className="grid grid-cols-1 gap-6 pb-40 lg:grid-cols-3 lg:pb-0">
        <div className="lg:col-span-2 card p-6 space-y-4">
          {[120, 80, 100, 90].map((w, i) => (
            <div key={i} className={`h-4 skeleton rounded`} style={{ width: `${w}%` }} />
          ))}
        </div>
        <div className="card p-6 space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 skeleton rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * DealDetails — shows full information for a single trade deal.
 *
 * Shipping-finance acronyms (FOB, CIF, B/L …) are wrapped in <TradeAcronym>
 * tooltips so retail investors can hover/focus to read plain-language definitions.
 */
export default function DealDetails({ dealId }: DealDetailsProps) {
  const [deal, setDeal] = useState<Deal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInvestModal, setShowInvestModal] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    getDealById(dealId)
      .then((data) => {
        if (active) setDeal(data);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load deal');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [dealId]);

  if (loading) return <DealDetailsSkeleton />;

  if (error || !deal) {
    return (
      <div className="card p-8 text-center">
        <p className="text-muted-foreground text-sm">
          {error ?? 'Deal not found.'}
        </p>
        <Link
          href="/marketplace"
          className="btn btn-md mt-4 border border-border text-foreground hover:bg-primary-muted"
        >
          ← Back to Marketplace
        </Link>
      </div>
    );
  }

  const pct = fundingPercent(deal);
  const tokensLeft = Math.max(0, Number(deal.token_count) - Math.floor(Number(deal.total_invested) / 100));
  const canInvest = deal.status === 'open' && tokensLeft > 0;

  return (
    <>
      {/* Breadcrumb */}
      <nav className="text-sm text-muted-foreground mb-4" aria-label="Breadcrumb">
        <ol className="flex items-center gap-2">
          <li><Link href="/marketplace" className="hover:text-primary transition-colors">Marketplace</Link></li>
          <li aria-hidden="true">›</li>
          <li className="text-foreground font-medium truncate">{deal.commodity}</li>
        </ol>
      </nav>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground capitalize">{deal.commodity}</h1>
          <p className="text-sm text-muted-foreground font-mono mt-1">{deal.token_symbol}</p>
        </div>
        <StatusBadge status={deal.status} />
      </div>

      <div className="grid grid-cols-1 gap-6 pb-40 lg:grid-cols-3 lg:pb-0">
        {/* ── Left: Deal Info ─────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Overview card */}
          <section className="card p-6" aria-labelledby="deal-overview-heading">
            <h2 id="deal-overview-heading" className="text-base font-semibold text-foreground mb-4">
              Deal Overview
            </h2>

            <InfoRow label="Commodity" value={<span className="capitalize">{deal.commodity}</span>} />
            <InfoRow
              label="Quantity"
              value={`${Number(deal.quantity).toLocaleString()} ${deal.quantity_unit}`}
            />
            <InfoRow label="Total Value" value={formatCurrency(deal.total_value)} />
            <InfoRow label="Delivery Date" value={formatDate(deal.delivery_date)} />
            {deal.annual_roi != null && (
              <InfoRow
                label="Expected ROI"
                value={
                  <span className="text-emerald-600">
                    {(Number(deal.annual_roi) * 100).toFixed(1)}% p.a.
                  </span>
                }
              />
            )}
            {deal.term_days != null && (
              <InfoRow label="Term Length" value={`${deal.term_days} days`} />
            )}
          </section>

          {/* Shipping terms card — acronyms get tooltips here */}
          <section className="card p-6" aria-labelledby="shipping-terms-heading">
            <h2 id="shipping-terms-heading" className="text-base font-semibold text-foreground mb-4">
              Shipping Terms
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              This shipment is traded under{' '}
              <TradeAcronym term="FOB" />{' '}
              terms. The seller arranges transport to the loading port, after which
              the buyer assumes all risk and cost. Mandatory insurance is carried to
              satisfy{' '}
              <TradeAcronym term="CIF" />{' '}
              requirements for letters of credit. Upon loading, the carrier issues a{' '}
              <TradeAcronym term="B/L" placement="top" />{' '}
              which serves as proof of shipment and title to the goods.
            </p>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(['FOB', 'CIF', 'B/L'] as const).map((term) => (
                <div
                  key={term}
                  className="rounded-xl border border-border bg-canvas p-3 flex items-center gap-2"
                >
                  <TradeAcronym term={term} />
                </div>
              ))}
            </div>
          </section>

          {/* Documents */}
          {deal.documents && deal.documents.length > 0 && (
            <section className="card p-6" aria-labelledby="documents-heading">
              <h2 id="documents-heading" className="text-base font-semibold text-foreground mb-4">
                Supporting Documents
              </h2>
              <ul className="space-y-2">
                {deal.documents.map((doc) => (
                  <li key={doc.id}>
                    <DocumentRow doc={doc} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Milestones */}
          {deal.milestones && deal.milestones.length > 0 && (
            <section className="card p-6" aria-labelledby="milestones-heading">
              <h2 id="milestones-heading" className="text-base font-semibold text-foreground mb-4">
                Shipment Milestones
              </h2>
              <ol className="relative border-l border-border pl-6 space-y-4">
                {deal.milestones.map((m, idx) => (
                  <li key={m.id} className="relative">
                    <span
                      className="absolute -left-[25px] top-1 w-3 h-3 rounded-full bg-primary border-2 border-surface ring-2 ring-primary/20"
                      aria-hidden="true"
                    />
                    <p className="text-sm font-semibold text-foreground capitalize">
                      {m.milestone}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {formatDate(m.recorded_at)}
                    </p>
                    {m.notes && (
                      <p className="text-xs text-muted-foreground mt-1">{m.notes}</p>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        {/* ── Right: Investment panel ──────────────────────────────────────── */}
        <aside className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface p-3 shadow-2xl lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none" aria-label="Investment panel">
          <div className="card p-4 space-y-4 lg:sticky lg:top-24 lg:p-6">
            <h2 className="text-base font-semibold text-foreground">Funding Progress</h2>

            {/* Progress bar */}
            <div>
              <div className="flex flex-wrap justify-between gap-2 text-xs font-medium text-muted-foreground mb-1.5">
                <span>{formatCurrency(deal.total_invested)} raised</span>
                <span>{pct}%</span>
              </div>
              <div
                className="h-2.5 w-full rounded-full bg-neutral-muted overflow-hidden"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Funding progress"
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-500 transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                of {formatCurrency(deal.total_value)} goal
              </p>
            </div>

            {/* Token stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-canvas border border-border p-3 text-center">
                <p className="text-xl font-black text-foreground tabular-nums">
                  {tokensLeft.toLocaleString()}
                </p>
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mt-0.5">
                  Tokens left
                </p>
              </div>
              <div className="rounded-xl bg-canvas border border-border p-3 text-center">
                <p className="text-xl font-black text-foreground tabular-nums">
                  $100
                </p>
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mt-0.5">
                  Per token
                </p>
              </div>
            </div>

            {/* CTA */}
            <button
              onClick={() => setShowInvestModal(true)}
              disabled={!canInvest}
              className="btn btn-md min-h-11 w-full bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              aria-label={canInvest ? `Invest in ${deal.commodity}` : 'Investment not available'}
            >
              {canInvest ? 'Invest Now' : deal.status === 'funded' ? 'Fully Funded' : 'Unavailable'}
            </button>

            {canInvest && (
              <p className="text-xs text-muted-foreground text-center">
                Minimum investment: 1 token ($100)
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* Investment modal */}
      {showInvestModal && (
        <InvestmentModal deal={deal} onClose={() => setShowInvestModal(false)} />
      )}
    </>
  );
}
