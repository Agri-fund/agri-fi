'use client';

import React, { useEffect, useState } from 'react';
import {
  api,
  getPriceNegotiations,
  submitPriceNegotiation,
  respondToPriceNegotiation,
  PriceNegotiation,
  User,
} from '@/lib/api';

interface PriceNegotiationThreadProps {
  dealId: string;
  farmerId?: string;
  traderId?: string;
  dealStatus?: string;
  currentTotalValue?: number;
  onPriceUpdated?: (newPrice: number) => void;
}

export function PriceNegotiationThread({
  dealId,
  farmerId,
  traderId,
  dealStatus,
  currentTotalValue,
  onPriceUpdated,
}: PriceNegotiationThreadProps) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [negotiations, setNegotiations] = useState<PriceNegotiation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showCounterForm, setShowCounterForm] = useState(false);
  const [proposedPrice, setProposedPrice] = useState<string>('');
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    let mounted = true;
    const user = api.getCurrentUser();
    if (user) {
      setCurrentUser(user);
    }

    async function loadData() {
      try {
        setLoading(true);
        setError(null);
        const data = await getPriceNegotiations(dealId);
        if (mounted) {
          setNegotiations(data);
        }
      } catch (err: any) {
        if (mounted) {
          // If 403 Forbidden, user is not a farmer/trader on this deal (e.g. investor)
          if (err?.response?.status === 403 || err?.message?.includes('403')) {
            setError('ACCESS_DENIED');
          } else {
            setError(err?.message || 'Failed to load negotiation thread');
          }
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [dealId]);

  // If user is investor or unauthorized, hide negotiation panel completely
  if (error === 'ACCESS_DENIED') {
    return null;
  }

  // Also check client side if user is an investor
  if (currentUser && currentUser.role === 'investor') {
    return null;
  }

  const isParty =
    currentUser &&
    (currentUser.id === farmerId ||
      currentUser.id === traderId ||
      currentUser.role === 'admin');

  if (currentUser && !isParty && currentUser.role !== 'admin') {
    return null;
  }

  const activePending = negotiations.find((n) => n.status === 'PENDING');
  const isProposerOfPending =
    activePending && currentUser && activePending.proposerId === currentUser.id;
  const isCounterpartOfPending =
    activePending && currentUser && activePending.proposerId !== currentUser.id;
  const isFinalized = [
    'funded',
    'delivered',
    'completed',
    'failed',
    'canceled',
    'expired',
  ].includes(dealStatus || '');
  const roundCount = negotiations.length;
  const maxRoundsReached = roundCount >= 10;

  const handleAction = async (status: 'ACCEPTED' | 'REJECTED') => {
    if (!activePending) return;
    try {
      setSubmitting(true);
      setError(null);
      await respondToPriceNegotiation(dealId, activePending.id, status);
      const updated = await getPriceNegotiations(dealId);
      setNegotiations(updated);
      if (status === 'ACCEPTED' && onPriceUpdated) {
        onPriceUpdated(Number(activePending.proposedPrice));
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to update negotiation');
    } finally {
      setSubmitting(false);
    }
  };

  const handleProposalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceNum = parseFloat(proposedPrice);
    if (isNaN(priceNum) || priceNum <= 0) {
      setError('Please enter a valid price greater than 0');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      await submitPriceNegotiation(dealId, priceNum, message || undefined);
      const updated = await getPriceNegotiations(dealId);
      setNegotiations(updated);
      setProposedPrice('');
      setMessage('');
      setShowCounterForm(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to submit proposal');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACCEPTED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
            Accepted
          </span>
        );
      case 'REJECTED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">
            Rejected
          </span>
        );
      case 'COUNTERED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
            Countered
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
            Pending
          </span>
        );
    }
  };

  return (
    <div className="card p-6 border border-slate-200 shadow-sm rounded-2xl bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5 border-b border-slate-100 pb-4">
        <div>
          <h2 className="section-title text-lg font-bold text-slate-900 flex items-center gap-2">
            🤝 Price Negotiation Thread
            <span className="text-xs px-2 py-0.5 font-semibold rounded-full bg-slate-100 text-slate-600">
              Round {roundCount} / 10
            </span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Private bilateral negotiation thread between farmer and trader. Maximum 10 rounds.
          </p>
        </div>
        {currentTotalValue && (
          <div className="text-right">
            <span className="text-xs text-slate-400 block font-medium">Current Deal Value</span>
            <span className="text-sm font-bold text-slate-800">
              ${Number(currentTotalValue).toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {error && error !== 'ACCESS_DENIED' && (
        <div className="p-3 mb-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3 py-4">
          <div className="h-12 skeleton rounded-xl" />
          <div className="h-12 skeleton rounded-xl" />
        </div>
      ) : negotiations.length === 0 ? (
        <div className="text-center py-6 text-slate-500 bg-slate-50 rounded-xl border border-dashed border-slate-200">
          <p className="text-sm font-medium">No price negotiations initiated yet.</p>
          <p className="text-xs text-slate-400 mt-1">
            Either the farmer or trader can propose a new price before funding.
          </p>
        </div>
      ) : (
        <div className="space-y-4 mb-6">
          {negotiations.map((item, idx) => {
            const isMe = currentUser && item.proposerId === currentUser.id;
            return (
              <div
                key={item.id}
                className={`p-4 rounded-xl border transition-all ${
                  item.status === 'PENDING'
                    ? 'border-blue-200 bg-blue-50/40 shadow-sm'
                    : item.status === 'ACCEPTED'
                    ? 'border-emerald-200 bg-emerald-50/30'
                    : 'border-slate-200 bg-slate-50/50'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-700">
                      Round {idx + 1} • {isMe ? 'You' : item.proposer?.fullName || 'Counterpart'}
                    </span>
                    {getStatusBadge(item.status)}
                  </div>
                  <span className="text-xs text-slate-400">
                    {new Date(item.createdAt).toLocaleString(undefined, {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </span>
                </div>

                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-xs text-slate-500">Proposed Price:</span>
                  <span className="text-base font-bold text-slate-900">
                    ${Number(item.proposedPrice).toLocaleString()}
                  </span>
                </div>

                {item.message && (
                  <p className="text-xs text-slate-600 bg-white/70 p-2.5 rounded-lg border border-slate-100 mt-2">
                    &ldquo;{item.message}&rdquo;
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Action panel for active PENDING proposal */}
      {activePending && isCounterpartOfPending && !isFinalized && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 mb-5">
          <h3 className="text-xs font-bold text-amber-900 mb-1">
            Pending Counter-Offer Received
          </h3>
          <p className="text-xs text-amber-800 mb-3">
            The counterpart proposed <strong>${Number(activePending.proposedPrice).toLocaleString()}</strong>.
            You can accept this proposal to update the deal total value, reject it, or propose a counter-offer.
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleAction('ACCEPTED')}
              disabled={submitting}
              className="px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition shadow-sm"
            >
              {submitting ? 'Processing…' : `Accept $${Number(activePending.proposedPrice).toLocaleString()}`}
            </button>
            <button
              onClick={() => handleAction('REJECTED')}
              disabled={submitting}
              className="px-4 py-2 text-xs font-bold rounded-xl bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50 transition"
            >
              Reject Proposal
            </button>
            {!maxRoundsReached && !showCounterForm && (
              <button
                onClick={() => setShowCounterForm(true)}
                disabled={submitting}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-50 transition shadow-sm"
              >
                Counter-Offer
              </button>
            )}
          </div>
        </div>
      )}

      {activePending && isProposerOfPending && (
        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 mb-4">
          ⏳ Your proposal of <strong>${Number(activePending.proposedPrice).toLocaleString()}</strong> is currently pending counterpart review.
        </div>
      )}

      {/* Form to submit new proposal / counter-offer */}
      {!isFinalized && !maxRoundsReached && (!activePending || isCounterpartOfPending && showCounterForm || (!activePending && negotiations.length === 0)) && (
        <form onSubmit={handleProposalSubmit} className="mt-4 pt-4 border-t border-slate-100">
          <h3 className="text-xs font-bold text-slate-800 mb-3">
            {activePending ? 'Submit Counter-Offer' : 'Propose New Price'}
          </h3>

          <div className="grid sm:grid-cols-3 gap-3 mb-3">
            <div className="sm:col-span-1">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Proposed Value (USD)
              </label>
              <input
                type="number"
                step="0.01"
                min="1"
                required
                value={proposedPrice}
                onChange={(e) => setProposedPrice(e.target.value)}
                placeholder="e.g. 52000"
                className="w-full text-xs px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Message / Rationale (Optional)
              </label>
              <input
                type="text"
                maxLength={500}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Reasoning for proposed price adjustment..."
                className="w-full text-xs px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition shadow-sm"
            >
              {submitting ? 'Submitting…' : activePending ? 'Submit Counter-Offer' : 'Send Proposal'}
            </button>
            {showCounterForm && (
              <button
                type="button"
                onClick={() => setShowCounterForm(false)}
                className="px-3 py-2 text-xs font-semibold rounded-xl text-slate-500 hover:text-slate-800"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {maxRoundsReached && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 mt-4">
          ⚠️ Maximum 10 negotiation rounds reached for this deal. Price negotiations are now closed.
        </div>
      )}
    </div>
  );
}
