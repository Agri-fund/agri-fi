'use client';

import { useId } from 'react';
import CopyButton from '@/components/ui/CopyButton';

export interface TxOperation {
  type?: string;
  amount?: string | number;
  asset_code?: string;
  assetCode?: string;
  asset_type?: string;
  from?: string;
  to?: string;
  source_account?: string;
  sourceAccount?: string;
  [key: string]: unknown;
}

export interface TxReceipt {
  hash: string;
  createdAt?: string | number | Date;
  timestamp?: string | number | Date;
  fee?: string | number;
  feeCharged?: string | number;
  ledger?: number | string | null;
  memo?: string | null;
  operations?: TxOperation[] | string[];
}

export interface TxReceiptModalProps {
  transaction: TxReceipt;
  onClose: () => void;
  isOpen?: boolean;
  explorerBaseUrl?: string;
}

const DEFAULT_EXPLORER =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'
    ? 'https://stellar.expert/explorer/public/tx'
    : 'https://stellar.expert/explorer/testnet/tx';

function formatTimestamp(value: TxReceipt['timestamp']): string {
  if (!value) return 'Unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
}

function timestampAttribute(value: TxReceipt['timestamp']): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function formatOperation(operation: TxOperation | string, index: number): string {
  if (typeof operation === 'string') return operation;

  const type = (operation.type ?? 'operation').replace(/_/g, ' ');
  const amount = operation.amount;
  const asset = operation.asset_code ?? operation.assetCode ?? (operation.asset_type === 'native' ? 'XLM' : 'asset');
  const destination = operation.to ?? operation.from;
  const counterparty = destination ? ` to ${shortHash(destination)}` : '';

  if (amount !== undefined && (operation.type === 'payment' || operation.type === 'path_payment_strict_send' || operation.type === 'path_payment_strict_receive')) {
    return `${capitalize(type)} ${amount} ${asset}${counterparty}`;
  }

  return `${index + 1}. ${capitalize(type)}${counterparty}`;
}

function shortHash(value: string): string {
  return value.length > 20 ? `${value.slice(0, 8)}…${value.slice(-8)}` : value;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-3 last:border-b-0">
      <dt className="flex-shrink-0 text-sm text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-medium text-slate-800">{children}</dd>
    </div>
  );
}

export default function TxReceiptModal({
  transaction,
  onClose,
  isOpen = true,
  explorerBaseUrl = DEFAULT_EXPLORER,
}: TxReceiptModalProps) {
  const titleId = useId();
  const operations = transaction.operations ?? [];
  const timestamp = transaction.createdAt ?? transaction.timestamp;
  const fee = transaction.feeCharged ?? transaction.fee;
  const explorerUrl = `${explorerBaseUrl.replace(/\/$/, '')}/${encodeURIComponent(transaction.hash)}`;
  const horizonBaseUrl =
    process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'
      ? 'https://horizon.stellar.org/transactions'
      : 'https://horizon-testnet.stellar.org/transactions';
  const horizonUrl = `${horizonBaseUrl}/${encodeURIComponent(transaction.hash)}`;

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="modal-panel w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="modal-header">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">Transaction complete</p>
            <h2 id={titleId} className="text-lg font-bold text-slate-900">Stellar transaction receipt</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close transaction receipt"
          >
            ×
          </button>
        </div>

        <div className="modal-body space-y-5">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white" aria-hidden="true">✓</span>
              Confirmed on Stellar
            </div>
            <div className="mt-3 flex items-center gap-1.5">
              <span className="min-w-0 flex-1 break-all font-mono text-xs text-emerald-900" title={transaction.hash}>
                {shortHash(transaction.hash)}
              </span>
              <CopyButton text={transaction.hash} label="transaction hash" />
            </div>
          </div>

          <dl>
            <DetailRow label="Executed">
              <time dateTime={timestampAttribute(timestamp)}>
                {formatTimestamp(timestamp)}
              </time>
            </DetailRow>
            <DetailRow label="Fee">{fee !== undefined ? `${fee} stroops` : 'Unavailable'}</DetailRow>
            <DetailRow label="Ledger">{transaction.ledger ?? 'Unavailable'}</DetailRow>
            <DetailRow label="Memo">
              <span className="break-all">{transaction.memo || 'None'}</span>
            </DetailRow>
          </dl>

          <section aria-labelledby={`${titleId}-operations`}>
            <h3 id={`${titleId}-operations`} className="mb-2 text-sm font-semibold text-slate-900">Operations</h3>
            {operations.length > 0 ? (
              <ol className="space-y-2">
                {operations.map((operation, index) => (
                  <li key={`${index}-${typeof operation === 'string' ? operation : operation.type ?? 'operation'}`} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    {formatOperation(operation, index)}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-slate-500">No operation details available.</p>
            )}
          </section>

          <div className="flex flex-col gap-2 sm:flex-row">
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary flex flex-1 items-center justify-center gap-2"
            >
              StellarExpert
              <span aria-hidden="true">↗</span>
            </a>
            <a
              href={horizonUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary flex flex-1 items-center justify-center gap-2"
            >
              Stellar Horizon
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export { TxReceiptModal };