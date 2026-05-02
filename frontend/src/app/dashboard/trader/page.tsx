'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient, Deal, User, MILESTONE_LABELS } from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import StatCard from '@/components/StatCard';
import { useToast } from '@/components/Toast';

const STATUS_CFG: Record<string, string> = {
  open: 'badge-green', funded: 'badge-blue', draft: 'badge-yellow',
  delivered: 'badge-purple', completed: 'badge-gray', failed: 'badge-red', cancelled: 'badge-red',
};

export default function TraderDashboard() {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDeal, setSelectedDeal] = useState<string | null>(null);
  const [milestoneForm, setMilestoneForm] = useState({ milestone: 'warehouse', notes: '' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const cached = apiClient.getCurrentUser();
      if (!cached) { router.push('/login'); return; }
      let u = cached;
      try { const f = await apiClient.refreshCurrentUser(); if (f) u = f; } catch {}
      if (u.role !== 'trader') { router.push(`/dashboard/${u.role}`); return; }
      setUser(u);
      loadDeals();
    })();
  }, [router]);

  const loadDeals = async () => {
    setLoading(true);
    try { setDeals(await apiClient.getTraderDeals()); } catch {}
    setLoading(false);
  };

  const handleMilestone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDeal) return;
    setSubmitting(true);
    try {
      await apiClient.recordMilestone(selectedDeal, {
        milestone: milestoneForm.milestone as any,
        notes: milestoneForm.notes,
      });
      toast('Milestone recorded! 📍', 'success');
      setSelectedDeal(null);
      loadDeals();
    } catch (err: any) {
      toast(err?.response?.data?.message ?? 'Failed to record milestone', 'error');
    } finally { setSubmitting(false); }
  };

  const totalValue  = deals.reduce((s, d) => s + Number(d.total_value), 0);
  const totalFunded = deals.reduce((s, d) => s + Number(d.total_invested), 0);
  const funded      = deals.filter(d => d.status === 'funded').length;
  const completed   = deals.filter(d => d.status === 'completed').length;

  if (!user) return null;

  return (
    <DashboardLayout user={user}>
      <div className="page-content">
        <div>
          <p className="text-sm text-slate-500 mb-1">Trade management</p>
          <h1 className="page-title">Trader Dashboard</h1>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Deals"  value={deals.length}                        icon="📋" color="bg-blue-50" />
          <StatCard label="Funded"       value={funded}                              icon="✅" color="bg-emerald-50" />
          <StatCard label="Completed"    value={completed}                           icon="🏆" color="bg-amber-50" />
          <StatCard label="Total Raised" value={`$${totalFunded.toLocaleString()}`}  icon="💰" color="bg-violet-50"
            trend={`of $${totalValue.toLocaleString()}`} trendUp={totalFunded > 0} />
        </div>

        {loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1,2,3].map(i => <div key={i} className="card h-56 skeleton" />)}
          </div>
        ) : deals.length === 0 ? (
          <div className="card p-14 text-center">
            <div className="w-16 h-16 rounded-3xl bg-blue-50 flex items-center justify-center text-3xl mx-auto mb-5">📋</div>
            <h3 className="font-bold text-slate-900 text-lg mb-2">No deals yet</h3>
            <p className="text-slate-500 text-sm">Trade deals assigned to you will appear here.</p>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-title">Your Deals</h2>
              <span className="muted">{deals.length} total</span>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {deals.map(deal => {
                const pct = deal.total_value > 0
                  ? Math.min((Number(deal.total_invested) / Number(deal.total_value)) * 100, 100) : 0;
                const canMilestone = ['funded', 'delivered'].includes(deal.status);
                const latestMilestone = deal.milestones?.[deal.milestones.length - 1];

                return (
                  <div key={deal.id} className="card-hover flex flex-col overflow-hidden">
                    <div className="h-1 bg-gradient-to-r from-blue-400 to-indigo-500" style={{ width: `${pct}%` }} />
                    <div className="p-5 flex flex-col gap-3 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-bold text-slate-900 capitalize">{deal.commodity}</h3>
                          <p className="text-xs text-slate-400 font-mono">{deal.token_symbol}</p>
                        </div>
                        <span className={STATUS_CFG[deal.status] ?? 'badge-gray'}>{deal.status}</span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {[
                          ['Quantity', `${Number(deal.quantity).toLocaleString()} ${deal.quantity_unit}`],
                          ['Value',    `$${Number(deal.total_value).toLocaleString()}`],
                          ['Raised',   `$${Number(deal.total_invested).toLocaleString()}`],
                          ['Delivery', new Date(deal.delivery_date).toLocaleDateString('en', { month: 'short', day: 'numeric', year: '2-digit' })],
                        ].map(([l, v]) => (
                          <div key={l} className="bg-slate-50 rounded-xl p-2.5">
                            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">{l}</p>
                            <p className="text-sm font-bold text-slate-900 mt-0.5 truncate">{v}</p>
                          </div>
                        ))}
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500">Funding</span>
                          <span className="font-bold text-blue-600">{pct.toFixed(1)}%</span>
                        </div>
                        <div className="progress-track">
                          <div className="progress-blue" style={{ width: `${pct}%` }} />
                        </div>
                      </div>

                      {latestMilestone && (
                        <div className="flex items-center gap-2 text-xs text-slate-500 pt-1 border-t border-slate-100">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                          <span>{MILESTONE_LABELS[latestMilestone.milestone]}</span>
                        </div>
                      )}

                      <div className="flex gap-2 mt-auto">
                        <Link href={`/marketplace/${deal.id}`}
                          className="btn-secondary text-xs py-2 flex-1 text-center">View</Link>
                        {canMilestone && (
                          <button
                            onClick={() => { setSelectedDeal(deal.id); setMilestoneForm({ milestone: 'warehouse', notes: '' }); }}
                            className="btn-primary text-xs py-2 flex-1">
                            + Milestone
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
      </div>

      {/* Milestone modal */}
      {selectedDeal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setSelectedDeal(null)}>
          <div className="modal-panel">
            <div className="modal-header">
              <div>
                <h2 className="font-bold text-slate-900 text-lg">Record Milestone</h2>
                <p className="text-xs text-slate-500 mt-0.5">Update shipment progress</p>
              </div>
              <button onClick={() => setSelectedDeal(null)}
                className="w-8 h-8 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-400 text-lg">×</button>
            </div>
            <form onSubmit={handleMilestone}>
              <div className="modal-body">
                <div>
                  <label className="label">Milestone stage</label>
                  <select className="select" value={milestoneForm.milestone}
                    onChange={e => setMilestoneForm(f => ({ ...f, milestone: e.target.value }))}>
                    <option value="farm">🌱 Farm</option>
                    <option value="warehouse">🏭 Warehouse</option>
                    <option value="port">⚓ Port</option>
                    <option value="importer">📦 Importer</option>
                  </select>
                </div>
                <div>
                  <label className="label">Notes</label>
                  <textarea className="textarea" rows={3} required
                    placeholder="Describe what happened at this stage…"
                    value={milestoneForm.notes}
                    onChange={e => setMilestoneForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" onClick={() => setSelectedDeal(null)} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={submitting} className="btn-primary flex-1">
                  {submitting ? 'Recording…' : '📍 Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
