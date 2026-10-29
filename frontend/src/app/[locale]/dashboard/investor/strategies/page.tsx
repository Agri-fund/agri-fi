'use client';

import { useEffect, useState } from 'react';
import { Activity, ArrowUpRight, Bell, Copy, FlaskConical, Pause, Play, Plus, Share2 } from 'lucide-react';
import { getAuthToken } from '@/lib/auth-token';
import { DashboardLayout } from '@/components/DashboardLayout';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

type Criteria = {
  minRoi?: number;
  maxRiskScore?: number;
  commodities?: string[];
  regions?: string[];
  maxDurationDays?: number;
};

type RiskLimits = {
  amountUsd: number;
  maxPositionUsd: number;
  maxPortfolioExposureUsd: number;
  maxOpenPositions: number;
  maxDailyAllocationUsd: number;
  stopLossPct: number | null;
};

type Strategy = {
  id: string;
  name: string;
  description: string | null;
  criteria: Criteria;
  riskLimits: RiskLimits;
  status: 'active' | 'paused' | 'archived';
  isPublic: boolean;
  version: number;
  versionHistory: Array<{ version: number; changedAt: string }>;
};

type Template = Pick<Strategy, 'name' | 'description' | 'criteria' | 'riskLimits'> & { id: string };
type Match = {
  id: string;
  dealId: string;
  allocationUsd: number;
  expectedRoi: number | null;
  matchReasons: string[];
  createdAt: string;
  deal: { title: string | null; commodity: string; farmLocation: string | null } | null;
};

type FormState = {
  name: string;
  description: string;
  minRoi: string;
  maxRiskScore: string;
  commodities: string;
  regions: string;
  maxDurationDays: string;
  amountUsd: string;
  maxPositionUsd: string;
  maxPortfolioExposureUsd: string;
  maxOpenPositions: string;
  maxDailyAllocationUsd: string;
  stopLossPct: string;
  isPublic: boolean;
};

const emptyForm: FormState = {
  name: '', description: '', minRoi: '', maxRiskScore: '60', commodities: '', regions: '',
  maxDurationDays: '', amountUsd: '500', maxPositionUsd: '1000',
  maxPortfolioExposureUsd: '5000', maxOpenPositions: '8', maxDailyAllocationUsd: '1500',
  stopLossPct: '10', isPublic: false,
};

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}/v1${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAuthToken()}`,
      ...(options?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

function inputValue(value: number | undefined | null) {
  return value == null ? '' : String(value);
}

function toForm(strategy: Strategy): FormState {
  return {
    name: strategy.name,
    description: strategy.description ?? '',
    minRoi: inputValue(strategy.criteria.minRoi),
    maxRiskScore: inputValue(strategy.criteria.maxRiskScore),
    commodities: strategy.criteria.commodities?.join(', ') ?? '',
    regions: strategy.criteria.regions?.join(', ') ?? '',
    maxDurationDays: inputValue(strategy.criteria.maxDurationDays),
    amountUsd: String(strategy.riskLimits.amountUsd),
    maxPositionUsd: String(strategy.riskLimits.maxPositionUsd),
    maxPortfolioExposureUsd: String(strategy.riskLimits.maxPortfolioExposureUsd),
    maxOpenPositions: String(strategy.riskLimits.maxOpenPositions),
    maxDailyAllocationUsd: String(strategy.riskLimits.maxDailyAllocationUsd),
    stopLossPct: inputValue(strategy.riskLimits.stopLossPct),
    isPublic: strategy.isPublic,
  };
}

function numeric(value: string, fallback?: number) {
  return value.trim() ? Number(value) : fallback;
}

function toPayload(form: FormState) {
  const list = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);
  return {
    name: form.name,
    description: form.description || null,
    criteria: {
      minRoi: numeric(form.minRoi),
      maxRiskScore: numeric(form.maxRiskScore),
      commodities: list(form.commodities),
      regions: list(form.regions),
      maxDurationDays: numeric(form.maxDurationDays),
    },
    riskLimits: {
      amountUsd: Number(form.amountUsd),
      maxPositionUsd: Number(form.maxPositionUsd),
      maxPortfolioExposureUsd: Number(form.maxPortfolioExposureUsd),
      maxOpenPositions: Number(form.maxOpenPositions),
      maxDailyAllocationUsd: Number(form.maxDailyAllocationUsd),
      stopLossPct: numeric(form.stopLossPct, 0),
    },
    isPublic: form.isPublic,
  };
}

function Field({ label, value, onChange, min, max, step = 'any', suffix }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  step?: string;
  suffix?: string;
}) {
  return (
    <label className="grid gap-1 text-sm text-slate-700">
      <span>{label}</span>
      <span className="flex items-center border-b border-slate-300 focus-within:border-emerald-700">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 w-full bg-transparent px-1 py-2 text-slate-950 outline-none"
        />
        {suffix && <span className="pr-1 text-slate-400">{suffix}</span>}
      </span>
    </label>
  );
}

export default function InvestmentStrategiesPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [shared, setShared] = useState<Array<{ id: string; name: string; description: string | null; version: number }>>([]);
  const [selected, setSelected] = useState<Strategy | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [performance, setPerformance] = useState<Record<string, unknown> | null>(null);
  const [backtest, setBacktest] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [mine, presets, community] = await Promise.all([
        apiFetch<Strategy[]>('/investment-strategies'),
        apiFetch<Template[]>('/investment-strategies/templates'),
        apiFetch<typeof shared>('/investment-strategies/shared'),
      ]);
      setStrategies(mine);
      setTemplates(presets);
      setShared(community);
      if (selected) setSelected(mine.find((item) => item.id === selected.id) ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load strategies.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const selectStrategy = async (strategy: Strategy) => {
    setSelected(strategy);
    setBacktest(null);
    try {
      const [recentMatches, metrics] = await Promise.all([
        apiFetch<Match[]>(`/investment-strategies/${strategy.id}/matches`),
        apiFetch<Record<string, unknown>>(`/investment-strategies/${strategy.id}/performance`),
      ]);
      setMatches(recentMatches);
      setPerformance(metrics);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load strategy activity.');
    }
  };

  const setField = (key: keyof FormState, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const edit = (strategy: Strategy) => {
    setEditingId(strategy.id);
    setForm(toForm(strategy));
    setShowForm(true);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = toPayload(form);
      const result = await apiFetch<Strategy>(editingId
        ? `/investment-strategies/${editingId}`
        : '/investment-strategies', {
          method: editingId ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        });
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
      await load();
      await selectStrategy(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save strategy.');
    } finally {
      setSaving(false);
    }
  };

  const createTemplate = async (id: string) => {
    try {
      await apiFetch(`/investment-strategies/templates/${id}`, { method: 'POST' });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create strategy.');
    }
  };

  const cloneShared = async (id: string) => {
    try {
      await apiFetch(`/investment-strategies/shared/${id}/clone`, { method: 'POST' });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not clone strategy.');
    }
  };

  const toggleStatus = async (strategy: Strategy) => {
    const status = strategy.status === 'active' ? 'paused' : 'active';
    try {
      await apiFetch(`/investment-strategies/${strategy.id}/status`, {
        method: 'PATCH', body: JSON.stringify({ status }),
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change strategy status.');
    }
  };

  const runBacktest = async () => {
    if (!selected) return;
    try {
      const result = await apiFetch<Record<string, unknown>>(`/investment-strategies/${selected.id}/backtest`, {
        method: 'POST', body: JSON.stringify({}),
      });
      setBacktest(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not run backtest.');
    }
  };

  return (
    <DashboardLayout>
      <main className="mx-auto max-w-6xl space-y-9 px-4 py-8 text-slate-900">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-emerald-800">Investor tools</p>
            <h1 className="text-3xl font-semibold">Investment strategies</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">Set deal filters and allocation limits. Matching deals appear here for review and approval.</p>
          </div>
          <button
            type="button"
            onClick={() => { setEditingId(null); setForm(emptyForm); setShowForm((value) => !value); }}
            className="inline-flex items-center gap-2 bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900"
          >
            <Plus size={16} aria-hidden="true" /> New strategy
          </button>
        </header>

        {error && <div role="alert" className="border-l-4 border-rose-700 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>}

        {showForm && (
          <section className="border-b border-slate-200 pb-8" aria-label="Strategy editor">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editingId ? 'Edit strategy' : 'Build a strategy'}</h2>
              <button type="button" onClick={() => setShowForm(false)} className="text-sm text-slate-500 underline">Close</button>
            </div>
            <form onSubmit={submit} className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1 text-sm text-slate-700">Strategy name
                  <input required maxLength={120} value={form.name} onChange={(event) => setField('name', event.target.value)} className="border-b border-slate-300 bg-transparent px-1 py-2 text-slate-950 outline-none focus:border-emerald-700" placeholder="Africa growth" />
                </label>
                <label className="grid gap-1 text-sm text-slate-700">Description
                  <input maxLength={2000} value={form.description} onChange={(event) => setField('description', event.target.value)} className="border-b border-slate-300 bg-transparent px-1 py-2 text-slate-950 outline-none focus:border-emerald-700" placeholder="Investment thesis" />
                </label>
              </div>

              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Deal criteria</h3>
                <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Minimum expected ROI" suffix="%" min={0} value={form.minRoi} onChange={(value) => setField('minRoi', value)} />
                  <Field label="Maximum risk score" suffix="/ 100" min={0} max={100} value={form.maxRiskScore} onChange={(value) => setField('maxRiskScore', value)} />
                  <Field label="Maximum duration" suffix="days" min={1} value={form.maxDurationDays} onChange={(value) => setField('maxDurationDays', value)} />
                  <label className="grid gap-1 text-sm text-slate-700">Commodities <span className="text-xs text-slate-400">Comma-separated; blank means any</span>
                    <input value={form.commodities} onChange={(event) => setField('commodities', event.target.value)} className="border-b border-slate-300 bg-transparent px-1 py-2 outline-none focus:border-emerald-700" placeholder="cocoa, coffee" />
                  </label>
                  <label className="grid gap-1 text-sm text-slate-700">Regions <span className="text-xs text-slate-400">Matches deal location text</span>
                    <input value={form.regions} onChange={(event) => setField('regions', event.target.value)} className="border-b border-slate-300 bg-transparent px-1 py-2 outline-none focus:border-emerald-700" placeholder="Africa, Ghana" />
                  </label>
                </div>
              </div>

              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Allocation and risk</h3>
                <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Target allocation per match" suffix="USD" min={100} value={form.amountUsd} onChange={(value) => setField('amountUsd', value)} />
                  <Field label="Maximum per deal" suffix="USD" min={100} value={form.maxPositionUsd} onChange={(value) => setField('maxPositionUsd', value)} />
                  <Field label="Maximum total exposure" suffix="USD" min={100} value={form.maxPortfolioExposureUsd} onChange={(value) => setField('maxPortfolioExposureUsd', value)} />
                  <Field label="Maximum open positions" min={1} max={100} step="1" value={form.maxOpenPositions} onChange={(value) => setField('maxOpenPositions', value)} />
                  <Field label="Maximum daily allocation" suffix="USD" min={100} value={form.maxDailyAllocationUsd} onChange={(value) => setField('maxDailyAllocationUsd', value)} />
                  <Field label="Stop-loss threshold" suffix="%" min={0} max={100} value={form.stopLossPct} onChange={(value) => setField('stopLossPct', value)} />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-4">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={form.isPublic} onChange={(event) => setField('isPublic', event.target.checked)} className="accent-emerald-800" />
                  Share strategy with the community
                </label>
                <button disabled={saving} className="bg-emerald-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-60">
                  {saving ? 'Saving...' : editingId ? 'Save version' : 'Create strategy'}
                </button>
              </div>
            </form>
          </section>
        )}

        <section className="grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
          <div>
            <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-2">
              <h2 className="font-semibold">Your strategies</h2>
              <span className="text-xs text-slate-500">{strategies.length} total</span>
            </div>
            {loading ? <p className="py-8 text-sm text-slate-500">Loading strategies...</p> : strategies.length === 0 ? (
              <p className="py-8 text-sm text-slate-500">No strategies yet. Start with a template or build your own.</p>
            ) : (
              <div className="divide-y divide-slate-200">
                {strategies.map((strategy) => (
                  <article key={strategy.id} className={`py-4 ${selected?.id === strategy.id ? 'border-l-2 border-emerald-800 pl-4' : ''}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <button className="min-w-0 text-left" onClick={() => void selectStrategy(strategy)}>
                        <span className="block font-semibold">{strategy.name}</span>
                        <span className="mt-1 block text-xs text-slate-500">v{strategy.version} · {strategy.criteria.minRoi ?? 0}%+ ROI · max risk {strategy.criteria.maxRiskScore ?? 100}</span>
                      </button>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${strategy.status === 'active' ? 'text-emerald-800' : 'text-slate-500'}`}>{strategy.status}</span>
                        <button title="Edit strategy" aria-label={`Edit ${strategy.name}`} onClick={() => edit(strategy)} className="p-2 text-slate-600 hover:bg-slate-100"><Activity size={16} /></button>
                        {strategy.status !== 'archived' && <button title={strategy.status === 'active' ? 'Pause strategy' : 'Resume strategy'} aria-label={`${strategy.status === 'active' ? 'Pause' : 'Resume'} ${strategy.name}`} onClick={() => void toggleStatus(strategy)} className="p-2 text-slate-600 hover:bg-slate-100">{strategy.status === 'active' ? <Pause size={16} /> : <Play size={16} />}</button>}
                        {strategy.isPublic && <Share2 size={15} className="text-emerald-800" aria-label="Shared with community" />}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-4 flex items-center gap-2 border-b border-slate-200 pb-2">
              <FlaskConical size={16} className="text-emerald-800" />
              <h2 className="font-semibold">Templates</h2>
            </div>
            <div className="divide-y divide-slate-200">
              {templates.map((template) => (
                <article key={template.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <h3 className="text-sm font-medium">{template.name}</h3>
                    <p className="mt-1 text-xs text-slate-500">{template.description}</p>
                  </div>
                  <button onClick={() => void createTemplate(template.id)} title={`Use ${template.name} template`} aria-label={`Use ${template.name} template`} className="p-2 text-emerald-800 hover:bg-emerald-50"><Plus size={17} /></button>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-center gap-2 border-b border-slate-200 pb-2">
            <Share2 size={16} className="text-emerald-800" />
            <h2 className="font-semibold">Community strategies</h2>
          </div>
          {shared.length === 0 ? <p className="text-sm text-slate-500">No community strategies shared yet.</p> : (
            <div className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
              {shared.map((item) => (
                <article key={item.id} className="flex items-start justify-between gap-3 border-b border-slate-200 py-3">
                  <div><h3 className="text-sm font-medium">{item.name}</h3><p className="mt-1 text-xs text-slate-500">Version {item.version} · {item.description}</p></div>
                  <button onClick={() => void cloneShared(item.id)} title="Copy strategy" aria-label={`Copy ${item.name}`} className="p-2 text-slate-600 hover:bg-slate-100"><Copy size={16} /></button>
                </article>
              ))}
            </div>
          )}
        </section>

        {selected && (
          <section className="border-t-2 border-slate-900 pt-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Strategy activity</p><h2 className="mt-1 text-xl font-semibold">{selected.name}</h2></div>
              <button onClick={() => void runBacktest()} className="inline-flex items-center gap-2 border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"><FlaskConical size={15} /> Run backtest</button>
            </div>
            {performance && <div className="mt-5 grid grid-cols-2 gap-4 border-y border-slate-200 py-4 sm:grid-cols-4">
              <Metric label="Matched deals" value={String(performance.matchCount ?? 0)} />
              <Metric label="Expected ROI" value={performance.averageExpectedRoiPct == null ? '—' : `${performance.averageExpectedRoiPct}%`} />
              <Metric label="Expected win rate" value={performance.expectedWinRatePct == null ? '—' : `${performance.expectedWinRatePct}%`} />
              <Metric label="Version" value={`v${selected.version}`} />
            </div>}
            {backtest && <div className="mt-5 border-l-4 border-amber-600 bg-amber-50 p-4 text-sm">
              <div className="flex items-center gap-2 font-semibold"><Activity size={16} /> Backtest estimate</div>
              <p className="mt-2">{String(backtest.tradeCount)} qualifying deals · {backtest.winRatePct == null ? 'No outcome data' : `${backtest.winRatePct}% win rate`} · {backtest.totalReturnPct == null ? '—' : `${backtest.totalReturnPct}% total return`} · {backtest.maxDrawdownPct == null ? '—' : `${backtest.maxDrawdownPct}% max drawdown`}</p>
              <p className="mt-1 text-xs text-amber-900">{String(backtest.methodology)}</p>
            </div>}
            <div className="mt-5">
              <h3 className="mb-2 text-sm font-semibold">Matched deals awaiting review</h3>
              {matches.length === 0 ? <p className="py-3 text-sm text-slate-500">No matches recorded for this strategy yet.</p> : (
                <div className="divide-y divide-slate-200">
                  {matches.map((match) => <article key={match.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div><p className="text-sm font-medium">{match.deal?.title || match.deal?.commodity || 'Trade deal'}</p><p className="mt-1 text-xs text-slate-500">{match.deal?.farmLocation} · {match.expectedRoi ?? '—'}% expected ROI · ${Number(match.allocationUsd).toLocaleString()} suggested allocation</p></div>
                    <a href={`/deals/${match.dealId}`} className="inline-flex items-center gap-1 text-sm font-medium text-emerald-800 hover:underline">Review deal <ArrowUpRight size={14} /></a>
                  </article>)}
                </div>
              )}
            </div>
            {selected.versionHistory?.length > 0 && <details className="mt-5 border-t border-slate-200 pt-3 text-sm">
              <summary className="cursor-pointer font-medium">Version history ({selected.versionHistory.length})</summary>
              <ol className="mt-3 space-y-2 text-xs text-slate-600">{selected.versionHistory.map((entry) => <li key={entry.version}>v{entry.version} · {new Date(entry.changedAt).toLocaleString()}</li>)}</ol>
            </details>}
          </section>
        )}

        <p className="flex items-start gap-2 border-t border-slate-200 pt-4 text-xs text-slate-500"><Bell size={14} className="mt-0.5 shrink-0" />Deal matches create an alert and a review item. Funding still requires your normal investment approval and wallet signature.</p>
      </main>
    </DashboardLayout>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>;
}