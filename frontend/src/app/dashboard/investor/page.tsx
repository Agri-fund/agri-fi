'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient, Investment, User } from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import StatCard from '@/components/StatCard';
import { InvestmentCertificate } from '@/components/InvestmentCertificate';
import { AnchorWidget } from '@/components/AnchorWidget';

const INV_STATUS: Record<string, string> = {
  confirmed: 'badge-green', pending: 'badge-yellow', failed: 'badge-red', refunded: 'badge-gray',
};
const DEAL_STATUS: Record<string, string> = {
  open: 'badge-green', funded: 'badge-blue', completed: 'badge-gray',
  delivered: 'badge-purple', failed: 'badge-red',
};

type Tab = 'portfolio' | 'certificates' | 'fiat';

export default function InvestorDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'confirmed' | 'pending'>('all');
  const [tab, setTab] = useState<Tab>('portfolio');

  useEffect(() => {
    (async () => {
      const cached = apiClient.getCurrentUser();
      if (!cached) { router.push('/login'); return; }
      let u = cached;
      try { const f = await apiClient.refreshCurrentUser(); if (f) u = f; } catch {}
      if (u.role !== 'investor') { router.push(`/dashboard/${u.role}`); return; }
      setUser(u);
      try { setInvestments(await apiClient.getInvestorInvestments()); } catch {}
      setLoading(false);
    })();
  }, [router]);

  const totalInvested = investments.reduce((s, i) => s + Number(i.amount_invested), 0);
  const totalTokens   = investments.reduce((s, i) => s + Number(i.token_holdings), 0);
  const totalExpected = investments.reduce((s, i) => s + Number(i.expected_return_usd), 0);
  const confirmed     = investments.filter(i => i.status === 'confirmed').length;

  const filtered = filter === 'all' ? investments
    : investments.filter(i => i.status === filter);

  const confirmedInvestments = investments.filter(i => i.status === 'confirmed');

  if (!user) return null;

  return (
    <DashboardLayout user={user}>
      <div className="page-content">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500 mb-1">Portfolio overview</p>
            <h1 className="page-title">Investor Dashboard</h1>
          </div>
          <div className="flex gap-2">
            <Link href="/transparency" className="btn-secondary flex-shrink-0 text-sm">
              🔍 Transparency
            </Link>
            <Link href="/marketplace" className="btn-primary flex-shrink-0">
              Browse Deals →
            </Link>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Invested"   value={`${totalInvested.toLocaleString()}`}  icon="💰" color="bg-violet-50" />
          <StatCard label="Confirmed"        value={confirmed}                              icon="✅" color="bg-emerald-50" />
          <StatCard label="Total Tokens"     value={totalTokens.toLocaleString()}           icon="🪙" color="bg-blue-50" />
          <StatCard label="Expected Returns" value={`${totalExpected.toLocaleString()}`}   icon="📈" color="bg-amber-50"
            trend={totalInvested > 0 ? `${((totalExpected / totalInvested - 1) * 100).toFixed(1)}% ROI` : undefined}
            trendUp={totalExpected > totalInvested} />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
          {([
            { key: 'portfolio', label: '📊 Portfolio' },
            { key: 'certificates', label: '🏆 Certificates' },
            { key: 'fiat', label: '💱 Fiat / USDC' },
          ] as { key: Tab; label: string }[]).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                tab === t.key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Portfolio tab ── */}
        {tab === 'portfolio' && (
          <>
            {investments.length > 0 && (
              <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
                {(['all', 'confirmed', 'pending'] as const).map(f => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold capitalize transition-all ${
                      filter === f ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
                    }`}>
                    {f}
                    <span className="ml-1.5 text-xs text-slate-400">
                      ({f === 'all' ? investments.length : investments.filter(i => i.status === f).length})
                    </span>
                  </button>
                ))}
              </div>
            )}

            {loading ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {[1,2,3].map(i => <div key={i} className="card h-56 skeleton" />)}
              </div>
            ) : investments.length === 0 ? (
              <div className="card p-14 text-center">
                <div className="w-16 h-16 rounded-3xl bg-violet-50 flex items-center justify-center text-3xl mx-auto mb-5">💼</div>
                <h3 className="font-bold text-slate-900 text-lg mb-2">No investments yet</h3>
                <p className="text-slate-500 text-sm mb-6 max-w-xs mx-auto">
                  Browse the marketplace to find agricultural projects to fund and earn returns.
                </p>
                <Link href="/marketplace" className="btn-primary mx-auto">Browse Marketplace →</Link>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="section-title">Your Portfolio</h2>
                  <span className="muted">{filtered.length} investment{filtered.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {filtered.map(inv => {
                    const pct = inv.deal.total_value > 0
                      ? Math.min((Number(inv.deal.funded_amount) / Number(inv.deal.total_value)) * 100, 100) : 0;
                    const isCompleted = inv.deal.status === 'completed';
                    const returnVal = isCompleted && inv.actual_return_usd != null
                      ? Number(inv.actual_return_usd) : Number(inv.expected_return_usd);
                    const returnLabel = isCompleted ? 'Actual Return' : 'Expected Return';

                    return (
                      <div key={inv.id} className="card-hover flex flex-col overflow-hidden">
                        <div className="h-1 bg-gradient-to-r from-violet-400 to-purple-500" style={{ width: `${pct}%` }} />
                        <div className="p-5 flex flex-col gap-3 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h3 className="font-bold text-slate-900 capitalize">{inv.deal.commodity}</h3>
                              <p className="text-xs text-slate-400 font-mono">{inv.deal.token_symbol}</p>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              <span className={INV_STATUS[inv.status] ?? 'badge-gray'}>{inv.status}</span>
                              <span className={DEAL_STATUS[inv.deal.status] ?? 'badge-gray'}>{inv.deal.status}</span>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            {[
                              ['Invested',    `${Number(inv.amount_invested).toLocaleString()}`, 'text-violet-700'],
                              ['Tokens',      Number(inv.token_holdings).toLocaleString(), ''],
                              [returnLabel,   `${returnVal.toLocaleString()}`, isCompleted ? 'text-emerald-600' : 'text-blue-600'],
                              inv.return_percentage != null
                                ? ['ROI', `${inv.return_percentage.toFixed(1)}%`, inv.return_percentage >= 0 ? 'text-emerald-600' : 'text-red-500']
                                : ['Deal Value', `${Number(inv.deal.total_value).toLocaleString()}`, ''],
                            ].map(([l, v, cls]) => (
                              <div key={l} className="bg-slate-50 rounded-xl p-2.5">
                                <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">{l}</p>
                                <p className={`text-sm font-bold mt-0.5 ${cls || 'text-slate-900'}`}>{v}</p>
                              </div>
                            ))}
                          </div>

                          <div className="space-y-1">
                            <div className="flex justify-between text-xs">
                              <span className="text-slate-500">Deal funding</span>
                              <span className="font-bold text-violet-600">{pct.toFixed(1)}%</span>
                            </div>
                            <div className="progress-track">
                              <div className="progress-purple" style={{ width: `${pct}%` }} />
                            </div>
                          </div>

                          <div className="flex gap-2 mt-auto">
                            <Link href={`/marketplace/${inv.deal.id}`}
                              className="btn-secondary text-xs py-2 text-center flex-1">
                              View Deal →
                            </Link>
                            {inv.status === 'confirmed' && (
                              <button
                                onClick={() => setTab('certificates')}
                                className="btn-secondary text-xs py-2 px-3"
                                title="View certificate"
                              >
                                🏆
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Certificates tab ── */}
        {tab === 'certificates' && (
          <div>
            <div className="mb-6">
              <h2 className="section-title">Investment Certificates</h2>
              <p className="text-sm text-slate-500 mt-1">
                Blockchain-verified proof of your investments. Each certificate is backed by an
                immutable Stellar transaction.
              </p>
            </div>
            {confirmedInvestments.length === 0 ? (
              <div className="card p-14 text-center">
                <div className="text-4xl mb-4">🏆</div>
                <h3 className="font-bold text-slate-900 mb-2">No certificates yet</h3>
                <p className="text-slate-500 text-sm">
                  Certificates are issued for confirmed investments.
                </p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-6">
                {confirmedInvestments.map(inv => (
                  <InvestmentCertificate
                    key={inv.id}
                    investmentId={inv.id}
                    dealId={inv.trade_deal_id}
                    commodity={inv.deal.commodity}
                    tokenAmount={Number(inv.token_holdings)}
                    amountUsd={Number(inv.amount_invested)}
                    stellarTxId={inv.stellar_tx_id ?? null}
                    sorobanContractId={inv.soroban_contract_id ?? null}
                    investorAddress={user?.walletAddress ?? ''}
                    createdAt={inv.created_at}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Fiat / USDC tab ── */}
        {tab === 'fiat' && (
          <div>
            <div className="mb-6">
              <h2 className="section-title">Fiat ↔ USDC</h2>
              <p className="text-sm text-slate-500 mt-1">
                Deposit local currency to get USDC for investing, or withdraw your earnings
                back to your bank account via Stellar Anchors.
              </p>
            </div>
            <div className="flex justify-center">
              <AnchorWidget />
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
