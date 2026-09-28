'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getAuthToken } from '@/lib/auth-token';
import { DashboardLayout } from '@/components/DashboardLayout';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

type Cadence = 'weekly' | 'biweekly' | 'monthly';
type PlanStatus = 'active' | 'paused' | 'cancelled';

interface AutoInvestPlan {
  id: string;
  amountUsd: string;
  cadence: Cadence;
  fundingWallet: string;
  maxRiskScore: string;
  dealTypeFilter: string[] | null;
  status: PlanStatus;
  dailyCapUsd: string | null;
  consecutiveFailures: number;
  nextRunAt: string;
  lastRunAt: string | null;
  createdAt: string;
}

const planSchema = z.object({
  amountUsd: z.coerce.number().min(100, 'Minimum $100'),
  cadence: z.enum(['weekly', 'biweekly', 'monthly']),
  fundingWallet: z.string().min(1, 'Funding wallet is required'),
  maxRiskScore: z.coerce.number().min(0).max(100).default(75),
  dealTypeFilter: z.string().optional(),
  dailyCapUsd: z.coerce.number().min(100).optional().nullable(),
});

type PlanFormValues = z.infer<typeof planSchema>;

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}/v1${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Request failed (${res.status})`);
  }
  return res.json();
}

const CADENCE_LABELS: Record<Cadence, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
};

const STATUS_COLORS: Record<PlanStatus, string> = {
  active: 'bg-green-100 text-green-800',
  paused: 'bg-amber-100 text-amber-800',
  cancelled: 'bg-slate-100 text-slate-600',
};

function PlanCard({
  plan,
  onPause,
  onResume,
  onCancel,
}: {
  plan: AutoInvestPlan;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const nextRun = new Date(plan.nextRunAt);
  const isOverdue = plan.status === 'active' && nextRun < new Date();

  return (
    <article
      className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
      aria-label={`Auto-invest plan ${plan.id.slice(0, 8)}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-mono text-slate-400">{plan.id.slice(0, 8)}…</p>
          <p className="text-2xl font-bold text-slate-900 mt-0.5">
            ${Number(plan.amountUsd).toLocaleString()}{' '}
            <span className="text-base font-normal text-slate-500">/ {CADENCE_LABELS[plan.cadence]}</span>
          </p>
        </div>
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[plan.status]}`}>
          {plan.status.charAt(0).toUpperCase() + plan.status.slice(1)}
        </span>
      </div>

      {/* Details grid */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-slate-500">Funding Wallet</dt>
          <dd className="font-mono text-slate-800 truncate">{plan.fundingWallet.slice(0, 12)}…</dd>
        </div>
        <div>
          <dt className="text-slate-500">Max Risk Score</dt>
          <dd className="text-slate-800">{Number(plan.maxRiskScore).toFixed(0)} / 100</dd>
        </div>
        {plan.dailyCapUsd && (
          <div>
            <dt className="text-slate-500">Daily Cap</dt>
            <dd className="text-slate-800">${Number(plan.dailyCapUsd).toLocaleString()}</dd>
          </div>
        )}
        {plan.dealTypeFilter?.length ? (
          <div>
            <dt className="text-slate-500">Commodities</dt>
            <dd className="text-slate-800">{plan.dealTypeFilter.join(', ')}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-slate-500">Next Run</dt>
          <dd className={`${isOverdue ? 'text-amber-600 font-medium' : 'text-slate-800'}`}>
            {nextRun.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
            {isOverdue && ' (overdue)'}
          </dd>
        </div>
        {plan.lastRunAt && (
          <div>
            <dt className="text-slate-500">Last Run</dt>
            <dd className="text-slate-800">
              {new Date(plan.lastRunAt).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
            </dd>
          </div>
        )}
      </dl>

      {/* Failure warning */}
      {plan.consecutiveFailures > 0 && (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-red-50 border border-red-200" role="alert">
          <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-xs text-red-700">{plan.consecutiveFailures} consecutive failure{plan.consecutiveFailures > 1 ? 's' : ''}</p>
        </div>
      )}

      {/* Actions */}
      {plan.status !== 'cancelled' && (
        <div className="flex items-center gap-2 pt-1">
          {plan.status === 'active' ? (
            <button
              onClick={() => onPause(plan.id)}
              className="flex-1 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 text-sm font-medium py-2 px-3 hover:bg-amber-100 transition-colors"
            >
              Pause
            </button>
          ) : (
            <button
              onClick={() => onResume(plan.id)}
              className="flex-1 rounded-lg border border-green-300 bg-green-50 text-green-700 text-sm font-medium py-2 px-3 hover:bg-green-100 transition-colors"
            >
              Resume
            </button>
          )}
          <button
            onClick={() => onCancel(plan.id)}
            className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm font-medium py-2 px-3 hover:bg-red-100 transition-colors"
            aria-label={`Cancel plan ${plan.id.slice(0, 8)}`}
          >
            Cancel
          </button>
        </div>
      )}
    </article>
  );
}

function CreatePlanForm({ onCreated }: { onCreated: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PlanFormValues>({
    resolver: zodResolver(planSchema),
    defaultValues: { maxRiskScore: 75, cadence: 'monthly' },
  });

  const onSubmit = async (data: PlanFormValues) => {
    setSubmitting(true);
    setError(null);
    try {
      const commodities = data.dealTypeFilter
        ? data.dealTypeFilter.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
        : undefined;

      await apiFetch('/auto-invest/plans', {
        method: 'POST',
        body: JSON.stringify({
          amountUsd: data.amountUsd,
          cadence: data.cadence,
          fundingWallet: data.fundingWallet,
          maxRiskScore: data.maxRiskScore,
          dealTypeFilter: commodities?.length ? commodities : undefined,
          dailyCapUsd: data.dailyCapUsd ?? undefined,
        }),
      });
      reset();
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" aria-label="Create auto-invest plan">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Amount */}
        <div>
          <label htmlFor="aip-amount" className="block text-sm font-medium text-slate-700 mb-1">
            Amount per run (USD)
          </label>
          <input
            id="aip-amount"
            type="number"
            min={100}
            step={100}
            {...register('amountUsd')}
            placeholder="500"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            aria-invalid={!!errors.amountUsd}
            aria-describedby={errors.amountUsd ? 'aip-amount-err' : undefined}
          />
          {errors.amountUsd && <p id="aip-amount-err" role="alert" className="text-xs text-red-600 mt-0.5">{errors.amountUsd.message}</p>}
        </div>

        {/* Cadence */}
        <div>
          <label htmlFor="aip-cadence" className="block text-sm font-medium text-slate-700 mb-1">
            Cadence
          </label>
          <select
            id="aip-cadence"
            {...register('cadence')}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every 2 weeks</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>

        {/* Funding wallet */}
        <div className="sm:col-span-2">
          <label htmlFor="aip-wallet" className="block text-sm font-medium text-slate-700 mb-1">
            Funding Wallet (Stellar address)
          </label>
          <input
            id="aip-wallet"
            type="text"
            {...register('fundingWallet')}
            placeholder="GABCDEF..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            aria-invalid={!!errors.fundingWallet}
            aria-describedby={errors.fundingWallet ? 'aip-wallet-err' : undefined}
          />
          {errors.fundingWallet && <p id="aip-wallet-err" role="alert" className="text-xs text-red-600 mt-0.5">{errors.fundingWallet.message}</p>}
        </div>

        {/* Max risk score */}
        <div>
          <label htmlFor="aip-risk" className="block text-sm font-medium text-slate-700 mb-1">
            Max risk score (0–100)
          </label>
          <input
            id="aip-risk"
            type="number"
            min={0}
            max={100}
            {...register('maxRiskScore')}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            aria-describedby="aip-risk-hint"
          />
          <p id="aip-risk-hint" className="text-xs text-slate-400 mt-0.5">Deals above this score are skipped. 0–25: Low; 26–50: Medium; 51–75: High; 76–100: Very High</p>
        </div>

        {/* Daily cap */}
        <div>
          <label htmlFor="aip-cap" className="block text-sm font-medium text-slate-700 mb-1">
            Daily cap (USD) <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <input
            id="aip-cap"
            type="number"
            min={100}
            step={100}
            {...register('dailyCapUsd')}
            placeholder="2000"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* Commodity filter */}
        <div className="sm:col-span-2">
          <label htmlFor="aip-commodities" className="block text-sm font-medium text-slate-700 mb-1">
            Commodity filter <span className="text-slate-400 font-normal">(optional, comma-separated)</span>
          </label>
          <input
            id="aip-commodities"
            type="text"
            {...register('dealTypeFilter')}
            placeholder="cocoa, coffee, wheat"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <p className="text-xs text-slate-400 mt-0.5">Leave blank to invest in any commodity</p>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-brand-600 text-white text-sm font-medium py-2.5 px-4 hover:bg-brand-700 disabled:opacity-60 transition-colors"
        aria-busy={submitting}
      >
        {submitting ? 'Creating…' : 'Create Auto-Invest Plan'}
      </button>
    </form>
  );
}

export default function AutoInvestPlansPage() {
  const [plans, setPlans] = useState<AutoInvestPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const data = await apiFetch<AutoInvestPlan[]>('/auto-invest/plans');
      setPlans(data);
    } catch (err: any) {
      setFetchError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  const handlePause = async (id: string) => {
    try {
      await apiFetch(`/auto-invest/plans/${id}/pause`, {
        method: 'PATCH',
        body: JSON.stringify({ paused: true }),
      });
      fetchPlans();
    } catch {}
  };

  const handleResume = async (id: string) => {
    try {
      await apiFetch(`/auto-invest/plans/${id}/pause`, {
        method: 'PATCH',
        body: JSON.stringify({ paused: false }),
      });
      fetchPlans();
    } catch {}
  };

  const handleCancel = async (id: string) => {
    if (!confirm('Cancel this auto-invest plan? This cannot be undone.')) return;
    try {
      await apiFetch(`/auto-invest/plans/${id}`, { method: 'DELETE' });
      fetchPlans();
    } catch {}
  };

  const activePlans = plans.filter(p => p.status === 'active');
  const pausedPlans = plans.filter(p => p.status === 'paused');
  const cancelledPlans = plans.filter(p => p.status === 'cancelled');

  return (
    <DashboardLayout>
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Page header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Auto-Invest Plans</h1>
            <p className="text-slate-500 text-sm mt-1">
              Recurring dollar-cost averaging — funds are automatically allocated to best-fit open deals.
            </p>
          </div>
          <button
            onClick={() => setShowForm(v => !v)}
            className="rounded-lg bg-brand-600 text-white text-sm font-medium py-2 px-4 hover:bg-brand-700 transition-colors flex items-center gap-2"
            aria-expanded={showForm}
            aria-controls="create-plan-form"
          >
            {showForm ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Cancel
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                New Plan
              </>
            )}
          </button>
        </div>

        {/* Create form */}
        {showForm && (
          <section
            id="create-plan-form"
            className="rounded-xl border border-brand-200 bg-brand-50/30 p-6"
            aria-label="Create new auto-invest plan"
          >
            <h2 className="text-base font-semibold text-slate-900 mb-4">New Auto-Invest Plan</h2>
            <CreatePlanForm
              onCreated={() => {
                setShowForm(false);
                fetchPlans();
              }}
            />
          </section>
        )}

        {/* Loading */}
        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" aria-busy="true" aria-label="Loading plans">
            {[1, 2].map(i => (
              <div key={i} className="rounded-xl border border-slate-200 p-5 space-y-3 animate-pulse">
                <div className="h-4 bg-slate-200 rounded w-1/3" />
                <div className="h-8 bg-slate-200 rounded w-2/3" />
                <div className="h-3 bg-slate-200 rounded w-full" />
                <div className="h-3 bg-slate-200 rounded w-3/4" />
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {fetchError && !loading && (
          <div role="alert" className="p-4 rounded-lg bg-red-50 border border-red-200">
            <p className="text-sm text-red-700">{fetchError}</p>
            <button onClick={fetchPlans} className="text-xs underline mt-1 text-red-600">Retry</button>
          </div>
        )}

        {/* Active plans */}
        {!loading && activePlans.length > 0 && (
          <section aria-label="Active plans">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Active ({activePlans.length})</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {activePlans.map(p => (
                <PlanCard key={p.id} plan={p} onPause={handlePause} onResume={handleResume} onCancel={handleCancel} />
              ))}
            </div>
          </section>
        )}

        {/* Paused plans */}
        {!loading && pausedPlans.length > 0 && (
          <section aria-label="Paused plans">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Paused ({pausedPlans.length})</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {pausedPlans.map(p => (
                <PlanCard key={p.id} plan={p} onPause={handlePause} onResume={handleResume} onCancel={handleCancel} />
              ))}
            </div>
          </section>
        )}

        {/* Cancelled plans */}
        {!loading && cancelledPlans.length > 0 && (
          <section aria-label="Cancelled plans">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Cancelled ({cancelledPlans.length})</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 opacity-60">
              {cancelledPlans.map(p => (
                <PlanCard key={p.id} plan={p} onPause={handlePause} onResume={handleResume} onCancel={handleCancel} />
              ))}
            </div>
          </section>
        )}

        {/* Empty state */}
        {!loading && !fetchError && plans.length === 0 && (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">🔄</div>
            <p className="text-slate-600 font-medium">No auto-invest plans yet</p>
            <p className="text-slate-400 text-sm mt-1">Create your first plan to start dollar-cost averaging into open deals.</p>
            <button
              onClick={() => setShowForm(true)}
              className="mt-4 rounded-lg bg-brand-600 text-white text-sm font-medium py-2 px-6 hover:bg-brand-700 transition-colors"
            >
              Create First Plan
            </button>
          </div>
        )}
      </main>
    </DashboardLayout>
  );
}
