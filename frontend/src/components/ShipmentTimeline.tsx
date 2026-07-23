'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface Milestone {
  id: string;
  milestone: string;
  notes: string | null;
  stellarTxId: string | null;
  recordedBy: string;
  recordedAt: string;
}

interface ShipmentTimelineProps {
  tradeDealId: string;
  initialMilestones?: any[];
  className?: string;
}

const SEQUENCE = ['farm', 'warehouse', 'port', 'importer'] as const;

const STEP_CONFIG: Record<string, { label: string; icon: string }> = {
  farm:      { label: 'Farm Collection',   icon: '🚜' },
  warehouse: { label: 'Warehouse Storage', icon: '🏭' },
  port:      { label: 'Port Shipment',     icon: '🚢' },
  importer:  { label: 'Importer Receipt',  icon: '📦' },
};

const normalize = (data: any[]): Milestone[] =>
  data.map(m => ({
    id: m.id,
    milestone: m.milestone,
    notes: m.notes,
    stellarTxId: m.stellar_tx_id ?? m.stellarTxId ?? null,
    recordedBy: m.recorded_by ?? m.recordedBy ?? '',
    recordedAt: m.recorded_at ?? m.recordedAt ?? '',
  }));

export const ShipmentTimeline: React.FC<ShipmentTimelineProps> = ({
  tradeDealId, initialMilestones, className = '',
}) => {
  const [milestones, setMilestones] = useState<Milestone[]>(
    initialMilestones ? normalize(initialMilestones) : []
  );
  const [loading, setLoading] = useState(!initialMilestones);
  const [error, setError] = useState<string | null>(null);

  const fetchMilestones = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const token = localStorage.getItem('auth_token');
      if (!token) throw new Error('Authentication required');
      const res = await fetch(`/api/shipments/${tradeDealId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch milestones');
      setMilestones(normalize(await res.json()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load milestones');
    } finally {
      setLoading(false);
    }
  }, [tradeDealId]);

  useEffect(() => {
    if (!initialMilestones) fetchMilestones();
  }, [fetchMilestones, initialMilestones]);

  const getStatus = (type: string) => {
    if (milestones.some(m => m.milestone === type)) return 'done';
    const firstMissing = SEQUENCE.findIndex(t => !milestones.some(m => m.milestone === t));
    if (firstMissing !== -1 && SEQUENCE[firstMissing] === type) return 'next';
    return 'pending';
  };

  if (loading) return (
    <div className={`space-y-4 ${className}`}>
      <div className="h-5 w-40 skeleton rounded-lg" />
      {[1,2,3,4].map(i => (
        <div key={i} className="flex items-center gap-4">
          <div className="w-9 h-9 skeleton rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-4 skeleton rounded-lg w-1/3" />
            <div className="h-3 skeleton rounded-lg w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );

  if (error) return (
    <div className={`alert-error ${className}`}>
      <span>⚠</span>
      <div>
        <p>{error}</p>
        <button onClick={fetchMilestones} className="underline text-xs mt-1">Try again</button>
      </div>
    </div>
  );

  const extraMilestones = milestones.filter(m => !STEP_CONFIG[m.milestone]);

  return (
    <div className={`space-y-5 ${className}`}>
      <h3 className="section-title">Shipment Timeline</h3>

      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-[17px] top-4 bottom-4 w-px bg-slate-200" />

        <div className="space-y-5">
          {SEQUENCE.map(type => {
            const status = getStatus(type);
            const m = milestones.find(x => x.milestone === type);
            const cfg = STEP_CONFIG[type];

            return (
              <div key={type} className="relative flex items-start gap-4">
                {/* Dot */}
                <div className={`relative z-10 w-9 h-9 rounded-full flex items-center justify-center text-sm flex-shrink-0 transition-all ${
                  status === 'done'    ? 'bg-brand-600 text-white shadow-sm' :
                  status === 'next'    ? 'bg-blue-500 text-white shadow-sm ring-4 ring-blue-100' :
                  'bg-slate-100 text-slate-400'
                }`}>
                  {status === 'done' ? '✓' : cfg.icon}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pt-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-sm font-semibold ${status === 'pending' ? 'text-slate-400' : 'text-slate-900'}`}>
                      {cfg.label}
                    </p>
                    {m && (
                      <span className="text-xs text-slate-400 flex-shrink-0">
                        {new Date(m.recordedAt).toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>

                  {m?.notes && (
                    <p className="text-sm text-slate-500 mt-0.5">{m.notes}</p>
                  )}
                  {m?.stellarTxId && (
                    <p className="text-xs text-slate-400 font-mono mt-0.5">
                      TX: {m.stellarTxId.slice(0, 20)}…
                    </p>
                  )}
                  {status === 'next' && !m && (
                    <p className="text-xs text-blue-500 mt-0.5 font-medium">Next milestone</p>
                  )}
                </div>
              </div>
            );
          })}

          {/* Extra milestones not in standard sequence */}
          {extraMilestones.map(m => (
            <div key={m.id} className="relative flex items-start gap-4">
              <div className="relative z-10 w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-sm flex-shrink-0">❓</div>
              <div className="flex-1 min-w-0 pt-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900 capitalize">{m.milestone.replace(/_/g, ' ')}</p>
                  <span className="text-xs text-slate-400">{new Date(m.recordedAt).toLocaleDateString()}</span>
                </div>
                {m.notes && <p className="text-sm text-slate-500 mt-0.5">{m.notes}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {milestones.length === 0 && (
        <div className="text-center py-8">
          <p className="text-slate-400 text-sm">No milestones recorded yet</p>
          <p className="text-slate-300 text-xs mt-1">Updates will appear here as the shipment progresses</p>
        </div>
      )}
    </div>
  );
};
