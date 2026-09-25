'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { apiClient, Deal, getStoredToken } from '@/lib/api';
import { useWallet } from '@/hooks/useWallet';
import { useToast } from '@/components/ui/ToastProvider';

// ── Types ────────────────────────────────────────────────────────────────────

interface AskOffer {
  offerId: string;
  seller: string;
  amount: string;
  price: string;
}

interface BidOffer {
  offerId: string;
  buyer: string;
  amount: string;
  price: string;
}

interface OrderBookRow {
  offerId: string;
  side: 'buy' | 'sell';
  counterparty: string;
  price: number;
  quantity: number;
}

interface TradePanelProps {
  deal: Deal;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncateAddress(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

// Minimal labeled input — associates a real <label> with the field via
// htmlFor/id and wires the hint through aria-describedby.
function LabeledField({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <input {...props} id={id} className="input" aria-describedby={hintId} />
      {hint && <p id={hintId} className="label-hint">{hint}</p>}
    </div>
  );
}

// ── Order book ────────────────────────────────────────────────────────────────

function OrderBookSection({ deal }: { deal: Deal }) {
  const [rows, setRows] = useState<OrderBookRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);

  const tokenCode = deal.token_symbol;
  const tokenIssuer = deal.issuer_public_key;

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setAuthRequired(true);
      setLoading(false);
      return;
    }
    if (!tokenCode || !tokenIssuer) {
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    const headers = { Authorization: `Bearer ${token}` };

    Promise.all([
      fetch(`/api/investments/offers/${encodeURIComponent(tokenCode)}/${encodeURIComponent(tokenIssuer)}`, { headers })
        .then((res) => (res.ok ? (res.json() as Promise<AskOffer[]>) : Promise.reject(new Error('Failed to load sell offers')))),
      fetch(`/api/investments/buy-orders/${encodeURIComponent(tokenCode)}/${encodeURIComponent(tokenIssuer)}`, { headers })
        .then((res) => (res.ok ? (res.json() as Promise<BidOffer[]>) : Promise.reject(new Error('Failed to load buy offers')))),
    ])
      .then(([asks, bids]) => {
        if (!active) return;
        const combined: OrderBookRow[] = [
          ...asks.map((a) => ({
            offerId: a.offerId,
            side: 'sell' as const,
            counterparty: a.seller,
            price: parseFloat(a.price),
            quantity: parseFloat(a.amount),
          })),
          ...bids.map((b) => ({
            offerId: b.offerId,
            side: 'buy' as const,
            counterparty: b.buyer,
            price: parseFloat(b.price),
            quantity: parseFloat(b.amount),
          })),
        ].sort((x, y) => y.price - x.price);
        setRows(combined);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Could not load order book');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [tokenCode, tokenIssuer]);

  return (
    <section className="card p-6" aria-labelledby="order-book-heading">
      <h2 id="order-book-heading" className="section-title mb-1">Order Book</h2>
      <p className="text-xs text-slate-400 mb-4">
        Live Stellar DEX offers for <span className="font-mono">{tokenCode}</span>
      </p>

      {authRequired && (
        <div className="alert-info" role="status">
          <span aria-hidden="true">🔒</span>
          <span>Sign in to view live buy and sell offers.</span>
        </div>
      )}

      {!authRequired && loading && (
        <p className="text-sm text-slate-400 animate-pulse" role="status">Loading order book…</p>
      )}

      {!authRequired && error && (
        <p className="text-sm text-red-600" role="alert">{error}</p>
      )}

      {!authRequired && !loading && !error && (!rows || rows.length === 0) && (
        <p className="text-sm text-slate-400">No active offers for this token yet.</p>
      )}

      {!authRequired && !loading && !error && rows && rows.length > 0 && (
        <div className="table-wrapper">
          <table className="min-w-full text-sm">
            <thead className="table-head">
              <tr>
                <th className="table-th">Offer ID</th>
                <th className="table-th">Side</th>
                <th className="table-th">Counterparty</th>
                <th className="table-th">Price (USDC)</th>
                <th className="table-th">Quantity</th>
                <th className="table-th">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.side}-${row.offerId}`} className="table-row">
                  <td className="table-td font-mono text-xs">{row.offerId}</td>
                  <td className="table-td">
                    <span className={row.side === 'buy' ? 'badge-green' : 'badge-red'}>
                      {row.side === 'buy' ? 'Buy' : 'Sell'}
                    </span>
                  </td>
                  <td className="table-td font-mono text-xs">{truncateAddress(row.counterparty)}</td>
                  <td className="table-td tabular-nums">{row.price.toFixed(4)}</td>
                  <td className="table-td tabular-nums">{row.quantity.toFixed(2)}</td>
                  <td className="table-td tabular-nums">{(row.price * row.quantity).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Price history chart placeholder ──────────────────────────────────────────

function PriceHistoryPlaceholder({ tokenCode }: { tokenCode: string }) {
  return (
    <section className="card p-6" aria-labelledby="price-history-heading">
      <h2 id="price-history-heading" className="section-title mb-1">Price History</h2>
      <p className="text-xs text-slate-400 mb-4">
        Secondary market price chart for <span className="font-mono">{tokenCode}</span>
      </p>
      <div className="h-56 rounded-2xl border border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-2 text-center px-4">
        <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18M7 14l4-4 3 3 5-6" />
        </svg>
        <p className="text-sm font-semibold text-slate-500">Price history coming soon</p>
        <p className="text-xs text-slate-400 max-w-xs">
          Charting for historical DEX trades will appear here once enough offers have filled.
        </p>
      </div>
    </section>
  );
}

// ── Create Sell Offer form ───────────────────────────────────────────────────

function CreateSellOfferForm({ deal }: { deal: Deal }) {
  const { isConnected, publicKey, connect, availableWallets, signTransaction } = useWallet();
  const { toast } = useToast();
  const [maxTokens, setMaxTokens] = useState(0);
  const [tokenAmount, setTokenAmount] = useState('1');
  const [pricePerToken, setPricePerToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successTxId, setSuccessTxId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiClient.getInvestorInvestments()
      .then((investments) => {
        if (!active) return;
        const held = investments
          .filter((inv) => inv.trade_deal_id === deal.id && inv.status === 'confirmed')
          .reduce((sum, inv) => sum + Number(inv.token_holdings), 0);
        setMaxTokens(held);
      })
      .catch(() => {
        if (active) setMaxTokens(0);
      });
    return () => {
      active = false;
    };
  }, [deal.id]);

  const amount = Number(tokenAmount) || 0;
  const price = Number(pricePerToken) || 0;
  const total = amount * price;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isConnected || !publicKey) {
      setError('Connect your wallet first.');
      return;
    }
    if (amount < 1 || amount > maxTokens) {
      setError(`Token amount must be between 1 and ${maxTokens}.`);
      return;
    }
    if (!pricePerToken || price <= 0) {
      setError('Enter a valid price per token.');
      return;
    }
    if (!deal.token_symbol || !deal.issuer_public_key) {
      setError('This deal does not have a tradable token yet.');
      return;
    }

    setSubmitting(true);
    try {
      const token = getStoredToken();
      if (!token) throw new Error('Please log in first.');

      const buildRes = await fetch('/api/investments/sell-offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          sellerWalletAddress: publicKey,
          tradeTokenCode: deal.token_symbol,
          tradeTokenIssuer: deal.issuer_public_key,
          tokenAmount: amount,
          pricePerToken: price.toFixed(7),
          offerId: 0,
        }),
      });
      if (!buildRes.ok) {
        const err = await buildRes.json().catch(() => ({}));
        throw new Error(err.message ?? 'Failed to build sell offer.');
      }
      const { unsignedXdr } = await buildRes.json();

      const signedXdr = await signTransaction(unsignedXdr);

      const submitRes = await fetch('/api/stellar/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ signedXdr }),
      });
      if (!submitRes.ok) {
        const err = await submitRes.json().catch(() => ({}));
        throw new Error(err.message ?? 'Failed to submit transaction.');
      }
      const result = await submitRes.json();
      const txId = result.hash ?? result.txId ?? 'submitted';
      setSuccessTxId(txId);
      toast('Sell offer created!', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sell offer failed.';
      setError(message);
      toast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (successTxId) {
    return (
      <div className="alert-success">
        <span aria-hidden="true">✅</span>
        <div>
          <p className="font-semibold">Sell offer created!</p>
          <p className="text-xs font-mono break-all mt-1">Tx: {successTxId}</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-label="Create sell offer">
      {!isConnected && (
        <div className="alert-warning">
          <span aria-hidden="true">⚠</span>
          <div className="flex-1">
            <p>Connect a wallet to list shares for sale.</p>
            {availableWallets.length > 0 && (
              <button
                type="button"
                onClick={() => connect(availableWallets[0])}
                className="btn-secondary text-xs mt-2 px-3 py-1.5"
              >
                Connect {availableWallets[0]}
              </button>
            )}
          </div>
        </div>
      )}

      <LabeledField
        label="Tokens to sell"
        type="number"
        min={1}
        max={maxTokens || undefined}
        value={tokenAmount}
        onChange={(e) => setTokenAmount(e.target.value)}
        hint={`Max available: ${maxTokens}`}
        disabled={submitting}
      />

      <LabeledField
        label="Price per token (USDC)"
        type="number"
        min="0.0000001"
        step="0.01"
        value={pricePerToken}
        onChange={(e) => setPricePerToken(e.target.value)}
        placeholder="e.g. 1.05"
        disabled={submitting}
      />

      {amount > 0 && total > 0 && (
        <div className="bg-slate-50 rounded-xl px-3 py-2 text-sm text-slate-600">
          You will receive up to <span className="font-semibold text-slate-800">{total.toFixed(2)} USDC</span> when the offer fills.
        </div>
      )}

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

      <button type="submit" disabled={submitting || !isConnected} className="btn-primary w-full">
        {submitting ? 'Submitting…' : 'Sign & Create Sell Offer'}
      </button>
    </form>
  );
}

// ── Create Buy Offer form (frontend-only — no backend buy-offer builder yet) ─

function CreateBuyOfferForm({ deal }: { deal: Deal }) {
  const [tokenAmount, setTokenAmount] = useState('1');
  const [pricePerToken, setPricePerToken] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const { toast } = useToast();

  const amount = Number(tokenAmount) || 0;
  const price = Number(pricePerToken) || 0;
  const total = amount * price;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (amount < 1) {
      setValidationError('Enter at least 1 token.');
      return;
    }
    if (!pricePerToken || price <= 0) {
      setValidationError('Enter a valid price per token.');
      return;
    }
    setValidationError(null);
    toast('Buy offers are coming soon — this feature is not live yet.', 'info');
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-label="Create buy offer">
      <div className="alert-info">
        <span aria-hidden="true">🚧</span>
        <span>Buy offer creation is coming soon. You can preview the form below.</span>
      </div>

      <LabeledField
        label="Tokens to buy"
        type="number"
        min={1}
        value={tokenAmount}
        onChange={(e) => setTokenAmount(e.target.value)}
        hint={`${deal.tokens_remaining ?? 0} tokens remaining in this deal`}
      />

      <LabeledField
        label="Price per token (USDC)"
        type="number"
        min="0.0000001"
        step="0.01"
        value={pricePerToken}
        onChange={(e) => setPricePerToken(e.target.value)}
        placeholder="e.g. 1.05"
      />

      {amount > 0 && total > 0 && (
        <div className="bg-slate-50 rounded-xl px-3 py-2 text-sm text-slate-600">
          Total cost: <span className="font-semibold text-slate-800">{total.toFixed(2)} USDC</span>
        </div>
      )}

      {validationError && <p className="text-sm text-red-600" role="alert">{validationError}</p>}

      <button type="submit" disabled className="btn-primary w-full" aria-disabled="true">
        Create Buy Offer — Coming Soon
      </button>
    </form>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function TradePanel({ deal }: TradePanelProps) {
  const [tab, setTab] = useState<'buy' | 'sell'>('buy');

  const hasTradableToken = useMemo(
    () => Boolean(deal.token_symbol && deal.issuer_public_key),
    [deal.token_symbol, deal.issuer_public_key],
  );

  return (
    <div className="grid lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 space-y-5">
        <OrderBookSection deal={deal} />
        <PriceHistoryPlaceholder tokenCode={deal.token_symbol} />
      </div>

      <div className="card p-6 h-fit lg:sticky lg:top-24">
        <h2 className="section-title mb-4">Create Offer</h2>

        {!hasTradableToken ? (
          <p className="text-sm text-slate-400">
            This deal does not have a tradable token on the Stellar DEX yet.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 mb-5" role="tablist" aria-label="Offer type">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'buy'}
                onClick={() => setTab('buy')}
                className={tab === 'buy' ? 'btn-primary' : 'btn-secondary'}
              >
                Buy
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'sell'}
                onClick={() => setTab('sell')}
                className={tab === 'sell' ? 'btn-primary' : 'btn-secondary'}
              >
                Sell
              </button>
            </div>

            {tab === 'buy' ? <CreateBuyOfferForm deal={deal} /> : <CreateSellOfferForm deal={deal} />}
          </>
        )}
      </div>
    </div>
  );
}
