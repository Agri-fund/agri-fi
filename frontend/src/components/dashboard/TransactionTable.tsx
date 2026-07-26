'use client';

import React, { useState, useCallback } from 'react';
import { Investment } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Transaction {
  id: string;
  /** ISO date string */
  date: string;
  type: 'investment' | 'return' | 'fee' | 'escrow_release';
  commodity: string;
  amount_usd: number;
  token_amount?: number;
  token_symbol?: string;
  status: 'pending' | 'confirmed' | 'failed';
  /** Stellar transaction ID (64-char hash) */
  stellar_tx_id?: string | null;
  /** Stellar ledger number */
  ledger?: number | null;
  /** Stellar memo */
  memo?: string | null;
}

interface TransactionTableProps {
  transactions: Transaction[];
  loading?: boolean;
  /** Controls visible page size */
  pageSize?: number;
  /** Optional caption for the table */
  caption?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(dateStr: string): { full: string; short: string } {
  const d = new Date(dateStr);
  return {
    full: d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    short: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
  };
}

function truncateHash(hash: string, chars = 8): string {
  if (hash.length <= chars * 2 + 3) return hash;
  return `${hash.slice(0, chars)}…${hash.slice(-chars)}`;
}

const TYPE_LABELS: Record<Transaction['type'], string> = {
  investment: 'Investment',
  return: 'Return',
  fee: 'Platform Fee',
  escrow_release: 'Escrow Release',
};

const TYPE_CLASSES: Record<Transaction['type'], string> = {
  investment: 'text-blue-600 bg-blue-50',
  return: 'text-emerald-600 bg-emerald-50',
  fee: 'text-slate-500 bg-slate-100',
  escrow_release: 'text-violet-600 bg-violet-50',
};

const STATUS_CLASSES: Record<Transaction['status'], string> = {
  confirmed: 'badge-green',
  pending: 'badge-gray',
  failed: 'badge-red',
};

// ── Copy-to-clipboard button ──────────────────────────────────────────────────

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be blocked — silently fail
    }
  }, [value]);

  return (
    <button
      onClick={handleCopy}
      className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      aria-label={copied ? 'Copied!' : `Copy ${label ?? 'value'}`}
      title={copied ? 'Copied!' : `Copy ${label ?? value}`}
    >
      {copied ? (
        <svg className="w-3 h-3 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );
}

// ── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="table-row">
      <td className="table-td"><div className="h-4 w-24 skeleton rounded" /></td>
      <td className="table-td"><div className="h-5 w-20 skeleton rounded-full" /></td>
      <td className="table-td"><div className="h-4 w-20 skeleton rounded" /></td>
      <td className="table-td"><div className="h-4 w-24 skeleton rounded" /></td>
      <td className="table-td hidden md:table-cell">
        <div className="h-4 w-36 skeleton rounded" />
      </td>
      <td className="table-td hidden lg:table-cell">
        <div className="h-4 w-16 skeleton rounded" />
      </td>
      <td className="table-td hidden lg:table-cell">
        <div className="h-4 w-24 skeleton rounded" />
      </td>
      <td className="table-td"><div className="h-5 w-16 skeleton rounded-full" /></td>
    </tr>
  );
}

// ── Mobile card view ──────────────────────────────────────────────────────────

function MobileCard({ tx }: { tx: Transaction }) {
  const date = formatDate(tx.date);
  const isCredit = tx.type === 'return' || tx.type === 'escrow_release';

  return (
    <div className="card p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground capitalize truncate">
            {tx.commodity}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            <time dateTime={tx.date}>{date.short}</time>
          </p>
        </div>
        <span className={`${STATUS_CLASSES[tx.status]} flex-shrink-0 capitalize`}>
          {tx.status}
        </span>
      </div>

      {/* Type + Amount row */}
      <div className="flex items-center justify-between">
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${TYPE_CLASSES[tx.type]}`}>
          {TYPE_LABELS[tx.type]}
        </span>
        <span className={`text-base font-bold tabular-nums ${isCredit ? 'text-emerald-600' : 'text-foreground'}`}>
          {isCredit ? '+' : '-'}{formatCurrency(tx.amount_usd)}
        </span>
      </div>

      {/* Token info */}
      {tx.token_amount != null && (
        <div className="text-xs text-muted-foreground">
          {tx.token_amount} {tx.token_symbol ?? 'tokens'} @ $100 each
        </div>
      )}

      {/* Stellar TX hash */}
      {tx.stellar_tx_id && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="font-medium">Tx:</span>
          <span className="font-mono truncate">
            {truncateHash(tx.stellar_tx_id)}
          </span>
          <CopyButton value={tx.stellar_tx_id} label="transaction hash" />
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * TransactionTable — responsive transaction history for an investor's dashboard.
 *
 * - Desktop (≥ lg): full table with all columns including ledger + memo.
 * - Tablet (md–lg): hides ledger and memo columns.
 * - Mobile (< md): collapses into stacked cards for readability.
 *
 * Long transaction hashes are truncated with ellipsis and a copy-to-clipboard
 * button is provided. Pagination is included to avoid very long lists.
 */
export default function TransactionTable({
  transactions,
  loading = false,
  pageSize = 10,
  caption = 'Transaction History',
}: TransactionTableProps) {
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(transactions.length / pageSize));
  const paginatedRows = transactions.slice((page - 1) * pageSize, page * pageSize);

  // Reset to page 1 when data changes
  React.useEffect(() => {
    setPage(1);
  }, [transactions.length]);

  if (loading) {
    return (
      <div className="space-y-4">
        {/* Mobile skeleton cards */}
        <div className="space-y-3 md:hidden">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card p-4 space-y-3 animate-pulse">
              <div className="flex justify-between">
                <div className="h-4 w-28 skeleton rounded" />
                <div className="h-5 w-16 skeleton rounded-full" />
              </div>
              <div className="flex justify-between">
                <div className="h-5 w-20 skeleton rounded-full" />
                <div className="h-5 w-24 skeleton rounded" />
              </div>
            </div>
          ))}
        </div>

        {/* Desktop skeleton table */}
        <div className="hidden md:block table-wrapper overflow-x-auto w-full">
          <table className="w-full border-collapse">
            <thead className="table-head">
              <tr>
                <th className="table-th">Date</th>
                <th className="table-th">Type</th>
                <th className="table-th">Commodity</th>
                <th className="table-th">Amount</th>
                <th className="table-th hidden md:table-cell">Transaction Hash</th>
                <th className="table-th hidden lg:table-cell">Ledger</th>
                <th className="table-th hidden lg:table-cell">Memo</th>
                <th className="table-th">Status</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="card p-12 flex flex-col items-center gap-3 text-center">
        <div className="w-14 h-14 rounded-full bg-neutral-muted flex items-center justify-center text-2xl" aria-hidden="true">
          📋
        </div>
        <p className="text-sm font-semibold text-foreground">No transactions yet</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          Your investment activity will appear here once you fund a trade deal.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Mobile: card list (hidden on md+) ──────────────────────────────── */}
      <div className="space-y-3 md:hidden" aria-label={caption}>
        {paginatedRows.map((tx) => (
          <MobileCard key={tx.id} tx={tx} />
        ))}
      </div>

      {/* ── Desktop: table (hidden below md) ───────────────────────────────── */}
      <div className="hidden md:block table-wrapper overflow-x-auto w-full rounded-xl border border-border">
        <table className="w-full border-collapse" aria-label={caption}>
          {caption && (
            <caption className="sr-only">{caption}</caption>
          )}
          <thead className="table-head">
            <tr>
              <th scope="col" className="table-th">Date</th>
              <th scope="col" className="table-th">Type</th>
              <th scope="col" className="table-th">Commodity</th>
              <th scope="col" className="table-th text-right">Amount (USD)</th>
              {/* Hidden on tablet, shown on desktop */}
              <th scope="col" className="table-th hidden lg:table-cell">Transaction Hash</th>
              <th scope="col" className="table-th hidden lg:table-cell text-right">Ledger</th>
              <th scope="col" className="table-th hidden xl:table-cell">Memo</th>
              <th scope="col" className="table-th">Status</th>
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((tx) => {
              const date = formatDate(tx.date);
              const isCredit = tx.type === 'return' || tx.type === 'escrow_release';

              return (
                <tr key={tx.id} className="table-row">
                  {/* Date */}
                  <td className="table-td whitespace-nowrap">
                    <time dateTime={tx.date} title={date.full} className="text-sm text-foreground">
                      {date.short}
                    </time>
                  </td>

                  {/* Type badge */}
                  <td className="table-td">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TYPE_CLASSES[tx.type]}`}>
                      {TYPE_LABELS[tx.type]}
                    </span>
                  </td>

                  {/* Commodity */}
                  <td className="table-td">
                    <span className="text-sm font-medium text-foreground capitalize">
                      {tx.commodity}
                    </span>
                    {tx.token_amount != null && (
                      <span className="block text-xs text-muted-foreground">
                        {tx.token_amount} {tx.token_symbol ?? 'tokens'}
                      </span>
                    )}
                  </td>

                  {/* Amount */}
                  <td className="table-td text-right whitespace-nowrap">
                    <span className={`text-sm font-bold tabular-nums ${isCredit ? 'text-emerald-600' : 'text-foreground'}`}>
                      {isCredit ? '+' : '-'}{formatCurrency(tx.amount_usd)}
                    </span>
                  </td>

                  {/* Transaction hash — hidden on tablet */}
                  <td className="table-td hidden lg:table-cell">
                    {tx.stellar_tx_id ? (
                      <div className="flex items-center gap-1 min-w-0">
                        <span
                          className="font-mono text-xs text-muted-foreground truncate max-w-[160px]"
                          title={tx.stellar_tx_id}
                        >
                          {truncateHash(tx.stellar_tx_id)}
                        </span>
                        <CopyButton value={tx.stellar_tx_id} label="transaction hash" />
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>

                  {/* Ledger — hidden on tablet */}
                  <td className="table-td hidden lg:table-cell text-right">
                    {tx.ledger != null ? (
                      <span className="text-xs font-mono text-muted-foreground">
                        {tx.ledger.toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>

                  {/* Memo — hidden on large tablets */}
                  <td className="table-td hidden xl:table-cell">
                    {tx.memo ? (
                      <span
                        className="text-xs text-muted-foreground truncate max-w-[120px] block"
                        title={tx.memo}
                      >
                        {tx.memo}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>

                  {/* Status */}
                  <td className="table-td">
                    <span className={`${STATUS_CLASSES[tx.status]} capitalize`}>
                      {tx.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ─────────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <nav
          className="flex items-center justify-between gap-4 pt-2"
          aria-label="Transaction pagination"
        >
          <p className="text-xs text-muted-foreground">
            Showing{' '}
            <span className="font-semibold text-foreground">
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, transactions.length)}
            </span>{' '}
            of{' '}
            <span className="font-semibold text-foreground">{transactions.length}</span> transactions
          </p>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn btn-sm border border-border text-foreground hover:bg-neutral-muted disabled:opacity-40"
              aria-label="Previous page"
            >
              ← Prev
            </button>

            {/* Page number pills */}
            <div className="hidden sm:flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  aria-current={p === page ? 'page' : undefined}
                  aria-label={`Page ${p}`}
                  className={`w-8 h-8 rounded-lg text-xs font-semibold transition-colors ${
                    p === page
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground hover:bg-neutral-muted'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            <span className="sm:hidden text-xs text-muted-foreground">
              {page} / {totalPages}
            </span>

            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="btn btn-sm border border-border text-foreground hover:bg-neutral-muted disabled:opacity-40"
              aria-label="Next page"
            >
              Next →
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}

// ── Adapter: convert Investment[] to Transaction[] ────────────────────────────

/**
 * Converts the API Investment type to the generic Transaction shape expected
 * by TransactionTable.
 */
export function investmentsToTransactions(investments: Investment[]): Transaction[] {
  return investments.map((inv) => ({
    id: inv.id,
    date: inv.created_at,
    type: 'investment' as const,
    commodity: inv.deal?.commodity ?? 'Trade Deal',
    amount_usd: inv.amount_usd,
    token_amount: inv.token_amount,
    token_symbol: inv.deal?.token_symbol,
    status: inv.status,
    stellar_tx_id: inv.stellar_tx_id ?? null,
    ledger: null,
    memo: null,
  }));
}
