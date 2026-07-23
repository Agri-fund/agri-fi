'use client';

import './print.css';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getDealById, Deal, getStoredToken } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PaymentDistribution {
  id: string;
  recipient_type: 'farmer' | 'investor' | 'platform';
  recipient_id: string | null;
  wallet_address: string;
  amount_usd: number;
  stellar_tx_id: string | null;
  status: 'confirmed' | 'failed';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortHash(hash: string | null | undefined, len = 16): string {
  if (!hash) return '—';
  return hash.length > len * 2 + 3
    ? `${hash.slice(0, len)}…${hash.slice(-8)}`
    : hash;
}

function statusBannerClass(status: string): string {
  if (status === 'completed') return 'receipt-status-banner completed';
  if (status === 'delivered') return 'receipt-status-banner delivered';
  if (status === 'funded') return 'receipt-status-banner funded';
  return 'receipt-status-banner other';
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    completed: '✅ Deal Completed — Escrow Released',
    delivered: '🚚 Delivered — Awaiting Escrow Release',
    funded: '💰 Fully Funded — Shipment in Progress',
    open: '🟢 Open for Investment',
    draft: '📝 Draft',
    failed: '❌ Failed',
  };
  return map[status] ?? status;
}

const MILESTONE_LABELS: Record<string, string> = {
  farm: 'Farm Collection',
  warehouse: 'Warehouse Storage',
  port: 'Port Departure',
  importer: 'Importer Delivery',
};

const HORIZON_BASE = 'https://stellar.expert/explorer/testnet/tx';

// ── Component ─────────────────────────────────────────────────────────────────

export default function ReceiptPage({ params }: { params: { id: string } }) {
  const [deal, setDeal] = useState<Deal | null>(null);
  const [distributions, setDistributions] = useState<PaymentDistribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const d = await getDealById(params.id);
        if (!d) { setError('Deal not found.'); return; }
        setDeal(d);

        // Fetch payment distributions if the deal is completed
        if (d.status === 'completed') {
          const token = getStoredToken();
          const res = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/escrow/distributions/${params.id}`,
            { headers: token ? { Authorization: `Bearer ${token}` } : {} },
          );
          if (res.ok) {
            const raw = await res.json();
            const list: PaymentDistribution[] = (Array.isArray(raw) ? raw : raw.data ?? []).map(
              (p: any) => ({
                id: p.id,
                recipient_type: p.recipientType ?? p.recipient_type,
                recipient_id: p.recipientId ?? p.recipient_id ?? null,
                wallet_address: p.walletAddress ?? p.wallet_address ?? '',
                amount_usd: Number(p.amountUsd ?? p.amount_usd ?? 0),
                stellar_tx_id: p.stellarTxId ?? p.stellar_tx_id ?? null,
                status: p.status ?? 'confirmed',
              }),
            );
            setDistributions(list);
          }
        }
      } catch (err: any) {
        setError(err?.message ?? 'Failed to load receipt.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.id]);

  // ── Loading ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="receipt-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: '#94a3b8' }}>
          <div style={{ width: 40, height: 40, border: '3px solid #e2e8f0', borderTopColor: '#166534', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 1rem' }} />
          <p style={{ fontSize: '0.875rem' }}>Loading receipt…</p>
        </div>
      </div>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────────

  if (error || !deal) {
    return (
      <div className="receipt-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <p style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>⚠️</p>
          <p style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Receipt unavailable</p>
          <p style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '1.5rem' }}>{error ?? 'Deal not found.'}</p>
          <Link href="/marketplace" className="btn-back">← Back to Marketplace</Link>
        </div>
      </div>
    );
  }

  // ── Derived values ──────────────────────────────────────────────────────────

  const totalValue = Number(deal.total_value);
  const farmerPayout = distributions.find(d => d.recipient_type === 'farmer');
  const platformPayout = distributions.find(d => d.recipient_type === 'platform');
  const investorPayouts = distributions.filter(d => d.recipient_type === 'investor');
  const generatedAt = new Date().toLocaleString('en-US', {
    dateStyle: 'long', timeStyle: 'short',
  });

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="receipt-page">

      {/* Toolbar — hidden on print */}
      <div className="receipt-toolbar no-print">
        <Link href={`/marketplace/${deal.id}`} className="btn-back">
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Deal
        </Link>
        <div className="receipt-toolbar-actions">
          <span style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>
            Deal #{deal.id.slice(0, 8).toUpperCase()}
          </span>
          <button
            className="btn-print"
            onClick={() => window.print()}
            aria-label="Print this receipt"
          >
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6v-8z" />
            </svg>
            Print Receipt
          </button>
        </div>
      </div>

      {/* A4 document */}
      <div className="receipt-wrapper">
        <div className="receipt-document">

          {/* Header */}
          <div className="receipt-header">
            <div className="receipt-brand">
              <span className="receipt-brand-icon">🌾</span>
              AgriFi
            </div>
            <div className="receipt-meta">
              <h1 className="receipt-title">Payment Receipt</h1>
              <p className="receipt-subtitle">
                {deal.id.toUpperCase()}
              </p>
            </div>
          </div>

          {/* Status banner */}
          <div className={statusBannerClass(deal.status)}>
            {statusLabel(deal.status)}
          </div>

          {/* Deal summary */}
          <div className="receipt-section">
            <p className="receipt-section-title">Deal Summary</p>
            <div className="receipt-grid">
              <div className="receipt-field">
                <span className="receipt-field-label">Commodity</span>
                <span className="receipt-field-value" style={{ textTransform: 'capitalize' }}>
                  {deal.commodity}
                </span>
              </div>
              <div className="receipt-field">
                <span className="receipt-field-label">Token Symbol</span>
                <span className="receipt-field-value mono">{deal.token_symbol}</span>
              </div>
              <div className="receipt-field">
                <span className="receipt-field-label">Quantity</span>
                <span className="receipt-field-value">
                  {Number(deal.quantity).toLocaleString()} {deal.quantity_unit}
                </span>
              </div>
              <div className="receipt-field">
                <span className="receipt-field-label">Delivery Date</span>
                <span className="receipt-field-value">
                  {new Date(deal.delivery_date).toLocaleDateString('en-US', {
                    year: 'numeric', month: 'long', day: 'numeric',
                  })}
                </span>
              </div>
              <div className="receipt-field">
                <span className="receipt-field-label">Total Deal Value</span>
                <span className="receipt-field-value large">${fmt(totalValue)} USD</span>
              </div>
              <div className="receipt-field">
                <span className="receipt-field-label">Status</span>
                <span className="receipt-field-value" style={{ textTransform: 'capitalize' }}>
                  {deal.status}
                </span>
              </div>
              {deal.issuer_public_key && (
                <div className="receipt-field receipt-grid-wide">
                  <span className="receipt-field-label">Token Issuer (Stellar)</span>
                  <span className="receipt-field-value mono">{deal.issuer_public_key}</span>
                </div>
              )}
            </div>
          </div>

          {/* Payment distributions — only shown when completed */}
          {distributions.length > 0 && (
            <div className="receipt-section">
              <p className="receipt-section-title">Payment Distributions</p>
              <table className="receipt-table">
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Wallet Address</th>
                    <th>Stellar TX</th>
                    <th>Amount (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Farmer */}
                  {farmerPayout && (
                    <tr>
                      <td style={{ fontWeight: 600 }}>🌾 Farmer (98%)</td>
                      <td className="mono">{shortHash(farmerPayout.wallet_address, 12)}</td>
                      <td className="mono">
                        {farmerPayout.stellar_tx_id ? (
                          <a
                            href={`${HORIZON_BASE}/${farmerPayout.stellar_tx_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#166534' }}
                          >
                            {shortHash(farmerPayout.stellar_tx_id)}
                          </a>
                        ) : '—'}
                      </td>
                      <td className="amount">${fmt(farmerPayout.amount_usd)}</td>
                    </tr>
                  )}

                  {/* Investors */}
                  {investorPayouts.map((inv, i) => (
                    <tr key={inv.id}>
                      <td style={{ fontWeight: 600 }}>💼 Investor {i + 1}</td>
                      <td className="mono">{shortHash(inv.wallet_address, 12)}</td>
                      <td className="mono">
                        {inv.stellar_tx_id ? (
                          <a
                            href={`${HORIZON_BASE}/${inv.stellar_tx_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#166534' }}
                          >
                            {shortHash(inv.stellar_tx_id)}
                          </a>
                        ) : '—'}
                      </td>
                      <td className="amount">${fmt(inv.amount_usd)}</td>
                    </tr>
                  ))}

                  {/* Platform fee */}
                  {platformPayout && (
                    <tr>
                      <td style={{ fontWeight: 600 }}>🏛 Platform Fee (2%)</td>
                      <td className="mono">{shortHash(platformPayout.wallet_address, 12)}</td>
                      <td className="mono">
                        {platformPayout.stellar_tx_id ? (
                          <a
                            href={`${HORIZON_BASE}/${platformPayout.stellar_tx_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#166534' }}
                          >
                            {shortHash(platformPayout.stellar_tx_id)}
                          </a>
                        ) : '—'}
                      </td>
                      <td className="amount">${fmt(platformPayout.amount_usd)}</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} style={{ fontWeight: 700 }}>Total Distributed</td>
                    <td className="amount">
                      ${fmt(distributions.reduce((s, d) => s + d.amount_usd, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Shipment milestones */}
          {deal.milestones && deal.milestones.length > 0 && (
            <div className="receipt-section">
              <p className="receipt-section-title">Shipment Milestones</p>
              <div className="milestone-list">
                {['farm', 'warehouse', 'port', 'importer'].map((step) => {
                  const m = deal.milestones!.find(x => x.milestone === step);
                  return (
                    <div key={step} className="milestone-item">
                      <div className={`milestone-dot${m ? '' : ' pending'}`} />
                      <div className="milestone-info">
                        <p className="milestone-name">
                          {MILESTONE_LABELS[step] ?? step}
                        </p>
                        {m ? (
                          <>
                            <p className="milestone-date">
                              {new Date(m.recorded_at).toLocaleString('en-US', {
                                dateStyle: 'medium', timeStyle: 'short',
                              })}
                            </p>
                            {m.stellar_tx_id && (
                              <p className="milestone-tx">
                                TX: {m.stellar_tx_id}
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="milestone-date" style={{ color: '#cbd5e1' }}>
                            Not yet recorded
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Document references */}
          {deal.documents && deal.documents.length > 0 && (
            <div className="receipt-section">
              <p className="receipt-section-title">Supporting Documents</p>
              <table className="receipt-table">
                <thead>
                  <tr>
                    <th>Document Type</th>
                    <th>IPFS Hash</th>
                    <th>Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  {deal.documents.map(doc => (
                    <tr key={doc.id}>
                      <td style={{ textTransform: 'capitalize', fontWeight: 600 }}>
                        {doc.doc_type.replace(/_/g, ' ')}
                      </td>
                      <td className="mono">{shortHash(doc.ipfs_hash)}</td>
                      <td>{new Date(doc.created_at).toLocaleDateString('en-US', { dateStyle: 'medium' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer */}
          <div className="receipt-footer">
            <p className="receipt-footer-note">
              This receipt is generated by AgriFi. All Stellar transactions are
              verifiable on the public ledger at stellar.expert.
            </p>
            <p className="receipt-footer-generated">Generated {generatedAt}</p>
          </div>

        </div>
      </div>
    </div>
  );
}
