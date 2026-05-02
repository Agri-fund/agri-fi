'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, User, getStoredToken } from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import StatCard from '@/components/StatCard';
import { useToast } from '@/components/Toast';

interface AdminUser {
  id: string; email: string; role: string; kycStatus: string;
  country: string; createdAt: string; walletAddress?: string | null;
}

const ROLE_BADGE: Record<string, string> = {
  farmer: 'badge-green', investor: 'badge-purple', trader: 'badge-blue',
  admin: 'badge-gray', company_admin: 'badge-orange',
};
const KYC_BADGE: Record<string, string> = {
  verified: 'badge-green', pending: 'badge-yellow', rejected: 'badge-red',
};

export default function AdminDashboard() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overview' | 'users' | 'kyc' | 'blockchain'>('overview');
  const [search, setSearch] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const cached = apiClient.getCurrentUser();
      if (!cached) { router.push('/login'); return; }
      let u = cached;
      try { const f = await apiClient.refreshCurrentUser(); if (f) u = f; } catch {}
      if (u.role !== 'admin') { router.push(`/dashboard/${u.role}`); return; }
      setUser(u);
      loadUsers();
    })();
  }, [router]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const token = getStoredToken();
      const res = await fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) { const d = await res.json(); setUsers(d.users ?? d ?? []); }
    } catch {}
    setLoading(false);
  };

  const approveKyc = async (userId: string) => {
    setActionId(userId);
    try {
      const token = getStoredToken();
      const res = await fetch(`/api/admin/kyc/${userId}/approve`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) { toast('KYC approved! ✅', 'success'); loadUsers(); }
      else { const d = await res.json(); toast(d.message ?? 'Failed', 'error'); }
    } catch { toast('Request failed', 'error'); }
    setActionId(null);
  };

  const updateRole = async (userId: string, role: string) => {
    setActionId(userId);
    try {
      const token = getStoredToken();
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (res.ok) { toast('Role updated!', 'success'); loadUsers(); }
      else { const d = await res.json(); toast(d.message ?? 'Failed', 'error'); }
    } catch { toast('Request failed', 'error'); }
    setActionId(null);
  };

  const pendingKyc = users.filter(u => u.kycStatus === 'pending');
  const verified   = users.filter(u => u.kycStatus === 'verified').length;
  const byRole     = (r: string) => users.filter(u => u.role === r).length;

  const filtered = users.filter(u =>
    !search || u.email.toLowerCase().includes(search.toLowerCase()) || u.role.includes(search.toLowerCase())
  );

  if (!user) return null;

  return (
    <DashboardLayout user={user}>
      <div className="page-content">
        <div>
          <p className="text-sm text-slate-500 mb-1">Platform management</p>
          <h1 className="page-title">Admin Dashboard</h1>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Users"  value={users.length}    icon="👥" color="bg-blue-50" />
          <StatCard label="Farmers"      value={byRole('farmer')} icon="🌱" color="bg-emerald-50" />
          <StatCard label="Investors"    value={byRole('investor')} icon="💼" color="bg-violet-50" />
          <StatCard label="KYC Verified" value={verified}         icon="✅" color="bg-amber-50"
            trend={`${pendingKyc.length} pending`} trendUp={pendingKyc.length === 0} />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
          {(['overview', 'users', 'kyc', 'blockchain'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold capitalize transition-all ${
                tab === t ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {t === 'blockchain' ? '⛓ Blockchain' : t}
              {t === 'kyc' && pendingKyc.length > 0 && (
                <span className="ml-1.5 bg-red-500 text-white text-[10px] rounded-full px-1.5 py-0.5 font-bold">
                  {pendingKyc.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Overview */}
        {tab === 'overview' && (
          <div className="grid sm:grid-cols-2 gap-5">
            <div className="card p-5">
              <h3 className="section-title mb-5">Users by Role</h3>
              <div className="space-y-3">
                {['farmer','investor','trader','company_admin','admin'].map(r => {
                  const count = byRole(r);
                  const pct = users.length ? (count / users.length) * 100 : 0;
                  return (
                    <div key={r} className="flex items-center gap-3">
                      <span className={`${ROLE_BADGE[r] ?? 'badge-gray'} w-24 justify-center`}>{r}</span>
                      <div className="flex-1 progress-track">
                        <div className="progress-green" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-sm font-bold text-slate-900 w-5 text-right">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card p-5">
              <h3 className="section-title mb-5">KYC Status</h3>
              <div className="space-y-3">
                {[['verified','badge-green'],['pending','badge-yellow'],['rejected','badge-red']].map(([s, cls]) => {
                  const count = users.filter(u => u.kycStatus === s).length;
                  const pct = users.length ? (count / users.length) * 100 : 0;
                  return (
                    <div key={s} className="flex items-center gap-3">
                      <span className={`${cls} w-20 justify-center`}>{s}</span>
                      <div className="flex-1 progress-track">
                        <div className={s === 'verified' ? 'progress-green' : s === 'pending' ? 'h-full bg-amber-400 rounded-full' : 'h-full bg-red-400 rounded-full'}
                          style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-sm font-bold text-slate-900 w-5 text-right">{count}</span>
                    </div>
                  );
                })}
              </div>

              {pendingKyc.length > 0 && (
                <button onClick={() => setTab('kyc')}
                  className="btn-primary w-full mt-5 text-sm">
                  Review {pendingKyc.length} pending KYC →
                </button>
              )}
            </div>
          </div>
        )}

        {/* Users table */}
        {tab === 'users' && (
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="relative flex-1 max-w-sm">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                  </svg>
                </span>
                <input className="input pl-10" placeholder="Search by email or role…"
                  value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <span className="flex items-center text-sm text-slate-500">{filtered.length} users</span>
            </div>

            {loading ? (
              <div className="card h-40 skeleton" />
            ) : (
              <div className="table-wrapper">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="table-head">
                      <tr>
                        {['Email','Role','KYC','Country','Joined','Change Role'].map(h => (
                          <th key={h} className="table-th">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(u => (
                        <tr key={u.id} className="table-row">
                          <td className="table-td font-medium text-slate-900">{u.email}</td>
                          <td className="table-td"><span className={ROLE_BADGE[u.role] ?? 'badge-gray'}>{u.role}</span></td>
                          <td className="table-td"><span className={KYC_BADGE[u.kycStatus] ?? 'badge-gray'}>{u.kycStatus}</span></td>
                          <td className="table-td text-slate-500">{u.country}</td>
                          <td className="table-td text-slate-400">{new Date(u.createdAt).toLocaleDateString()}</td>
                          <td className="table-td">
                            <select
                              disabled={actionId === u.id}
                              defaultValue={u.role}
                              onChange={e => updateRole(u.id, e.target.value)}
                              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50">
                              {['farmer','trader','investor','company_admin','admin'].map(r => (
                                <option key={r} value={r}>{r}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filtered.length === 0 && (
                    <div className="text-center py-12 text-slate-400">No users found</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* KYC review */}
        {tab === 'kyc' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="section-title">Pending KYC Reviews</h2>
              <span className="muted">{pendingKyc.length} pending</span>
            </div>

            {pendingKyc.length === 0 ? (
              <div className="card p-14 text-center">
                <div className="w-16 h-16 rounded-3xl bg-emerald-50 flex items-center justify-center text-3xl mx-auto mb-5">✅</div>
                <h3 className="font-bold text-slate-900 text-lg mb-2">All clear!</h3>
                <p className="text-slate-500 text-sm">No pending KYC submissions to review.</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {pendingKyc.map(u => (
                  <div key={u.id} className="card p-5 space-y-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center font-bold text-slate-600">
                          {u.email[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold text-slate-900 text-sm truncate max-w-[140px]">{u.email}</p>
                          <p className="text-xs text-slate-400">{u.country}</p>
                        </div>
                      </div>
                      <span className={ROLE_BADGE[u.role] ?? 'badge-gray'}>{u.role}</span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Submitted {new Date(u.createdAt).toLocaleDateString()}</span>
                      <span className="badge-yellow">pending</span>
                    </div>

                    <button
                      disabled={actionId === u.id}
                      onClick={() => approveKyc(u.id)}
                      className="btn-primary w-full text-sm py-2.5">
                      {actionId === u.id ? (
                        <span className="flex items-center gap-2">
                          <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                          </svg>
                          Approving…
                        </span>
                      ) : '✓ Approve KYC'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Blockchain tab */}
        {tab === 'blockchain' && (
          <BlockchainTab token={getStoredToken() ?? ''} toast={toast} />
        )}
      </div>
    </DashboardLayout>
  );
}

// ── Blockchain Tab ────────────────────────────────────────────────────────────

interface BlockchainTabProps {
  token: string;
  toast: (msg: string, type: 'success' | 'error') => void;
}

function BlockchainTab({ token, toast }: BlockchainTabProps) {
  const [contractId, setContractId] = useState('');
  const [action, setAction] = useState<'approve' | 'pause' | 'fail' | 'milestone' | 'distribute'>('approve');
  const [milestoneIndex, setMilestoneIndex] = useState(0);
  const [revenueAmount, setRevenueAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contractId.trim()) return;
    setLoading(true);
    setResult(null);

    try {
      let url = `/api/soroban/campaign/${contractId.trim()}/${action}`;
      let body: Record<string, unknown> = {};

      if (action === 'milestone') body = { milestoneIndex };
      if (action === 'distribute') body = { revenueAmountStroops: revenueAmount };

      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        toast(`✅ ${action} succeeded`, 'success');
        setResult(data.txHash ?? JSON.stringify(data));
      } else {
        toast(data.message ?? 'Action failed', 'error');
      }
    } catch {
      toast('Request failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="section-title">Soroban Contract Management</h2>
        <p className="text-sm text-slate-500 mt-1">
          Invoke on-chain actions on FarmCampaign smart contracts.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-5">
        {/* Action form */}
        <div className="card p-5">
          <h3 className="font-semibold text-slate-900 mb-4">Contract Action</h3>
          <form onSubmit={handleAction} className="space-y-4">
            <div>
              <label className="label">Contract ID</label>
              <input className="input font-mono text-xs" placeholder="C..." value={contractId}
                onChange={e => setContractId(e.target.value)} required />
            </div>

            <div>
              <label className="label">Action</label>
              <select className="select" value={action}
                onChange={e => setAction(e.target.value as typeof action)}>
                <option value="approve">✅ Approve Campaign</option>
                <option value="milestone">📍 Release Milestone</option>
                <option value="distribute">💰 Distribute Revenue</option>
                <option value="pause">⏸ Pause Campaign</option>
                <option value="fail">❌ Mark Failed</option>
              </select>
            </div>

            {action === 'milestone' && (
              <div>
                <label className="label">Milestone Index (0-based)</label>
                <input className="input" type="number" min={0} max={3} value={milestoneIndex}
                  onChange={e => setMilestoneIndex(Number(e.target.value))} />
              </div>
            )}

            {action === 'distribute' && (
              <div>
                <label className="label">Revenue Amount (USDC stroops)</label>
                <input className="input" placeholder="e.g. 500000000000 = 50,000 USDC"
                  value={revenueAmount} onChange={e => setRevenueAmount(e.target.value)} required />
                <p className="label-hint">1 USDC = 10,000,000 stroops</p>
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Submitting…' : 'Execute On-Chain'}
            </button>
          </form>

          {result && (
            <div className="mt-4 p-3 bg-emerald-50 rounded-xl">
              <p className="text-xs text-emerald-700 font-semibold mb-1">Transaction Hash</p>
              <p className="font-mono text-xs text-emerald-900 break-all">{result}</p>
            </div>
          )}
        </div>

        {/* Info panel */}
        <div className="card p-5 space-y-4">
          <h3 className="font-semibold text-slate-900">Contract Lifecycle</h3>
          {[
            { step: '1', label: 'Deal Published', desc: 'Soroban FarmCampaign auto-initialized on deal.publish queue event' },
            { step: '2', label: 'Approve Campaign', desc: 'After KYC + funding target reached, admin approves on-chain' },
            { step: '3', label: 'Release Milestones', desc: 'Release 1 of 4 tranches to farmer per verified milestone' },
            { step: '4', label: 'Distribute Revenue', desc: 'After harvest sales, distribute USDC to all investors proportionally' },
          ].map(item => (
            <div key={item.step} className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-green-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                {item.step}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                <p className="text-xs text-slate-500">{item.desc}</p>
              </div>
            </div>
          ))}

          <div className="pt-2 border-t border-slate-100">
            <a href="/transparency" target="_blank"
              className="text-sm text-green-600 hover:underline font-medium">
              🔍 View public transparency page →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
