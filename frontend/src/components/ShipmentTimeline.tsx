'use client';

import { getAuthToken } from '@/lib/auth-token';
import React, { useState, useEffect, useCallback } from 'react';

interface EvidenceItem {
  id: string;
  storage_url: string;
  doc_type: string;
}

interface Milestone {
  id: string;
  milestone: string;
  notes: string | null;
  stellarTxId: string | null;
  recordedBy: string;
  recordedAt: string;
  latitude?: number | null;
  longitude?: number | null;
  evidenceDocumentIds?: string[] | null;
  evidence?: EvidenceItem[];
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
    latitude: m.latitude ?? null,
    longitude: m.longitude ?? null,
    evidenceDocumentIds: m.evidence_document_ids ?? m.evidenceDocumentIds ?? null,
  }));

function MapLink({ lat, lng }: { lat: number; lng: number }) {
  const url = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}&zoom=14`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 hover:underline mt-0.5"
      aria-label={`View location on map: ${lat.toFixed(4)}, ${lng.toFixed(4)}`}
    >
      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
      {lat.toFixed(4)}, {lng.toFixed(4)}
    </a>
  );
}

function EvidenceThumbnails({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  const token = getAuthToken();

  return (
    <div className="flex flex-wrap gap-2 mt-2" role="list" aria-label="Evidence photos">
      {ids.map((docId) => (
        <a
          key={docId}
          href={`/api/documents/${docId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="group relative block w-14 h-14 rounded overflow-hidden border border-slate-200 hover:border-brand-400 transition-colors"
          aria-label={`View evidence document ${docId.slice(0, 8)}`}
          role="listitem"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001'}/v1/documents/${docId}/thumb`}
            alt={`Evidence ${docId.slice(0, 8)}`}
            className="w-full h-full object-cover"
            onError={(e) => {
              // Fallback to document icon on load failure
              (e.target as HTMLImageElement).style.display = 'none';
              const parent = (e.target as HTMLImageElement).parentElement;
              if (parent) {
                const fallback = parent.querySelector('[data-fallback]') as HTMLElement | null;
                if (fallback) fallback.style.display = 'flex';
              }
            }}
          />
          {/* Fallback icon */}
          <span
            data-fallback=""
            className="absolute inset-0 hidden items-center justify-center bg-slate-50 text-slate-400 text-xl"
            aria-hidden="true"
          >
            🖼
          </span>
          {/* Hover overlay */}
          <span className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center" aria-hidden="true">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </span>
        </a>
      ))}
    </div>
  );
}

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
      const token = getAuthToken();
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
    <div className={`space-y-4 ${className}`} aria-busy="true" aria-label="Loading shipment timeline">
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
    <div className={`alert-error ${className}`} role="alert">
      <span aria-hidden="true">⚠</span>
      <div>
        <p>{error}</p>
        <button onClick={fetchMilestones} className="underline text-xs mt-1">Try again</button>
      </div>
    </div>
  );

  const extraMilestones = milestones.filter(m => !STEP_CONFIG[m.milestone]);

  return (
    <div className={`max-w-full space-y-5 overflow-hidden ${className}`}>
      <h3 className="section-title">Shipment Timeline</h3>

      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-[17px] top-4 bottom-4 w-px bg-slate-200" aria-hidden="true" />

        <ol className="space-y-5" aria-label="Shipment milestones">
          {SEQUENCE.map(type => {
            const status = getStatus(type);
            const m = milestones.find(x => x.milestone === type);
            const cfg = STEP_CONFIG[type];
            const hasEvidence = (m?.evidenceDocumentIds?.length ?? 0) > 0;
            const hasLocation = m?.latitude != null && m?.longitude != null;

            return (
              <li key={type} className="relative flex items-start gap-4">
                {/* Dot */}
                <div
                  className={`relative z-10 w-9 h-9 rounded-full flex items-center justify-center text-sm flex-shrink-0 transition-all ${
                    status === 'done'    ? 'bg-brand-600 text-white shadow-sm' :
                    status === 'next'    ? 'bg-blue-500 text-white shadow-sm ring-4 ring-blue-100' :
                    'bg-slate-100 text-slate-400'
                  }`}
                  aria-label={status === 'done' ? 'Completed' : status === 'next' ? 'Next' : 'Pending'}
                >
                  {status === 'done' ? '✓' : cfg.icon}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pt-1.5">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                    <p className={`break-words text-sm font-semibold ${status === 'pending' ? 'text-slate-400' : 'text-slate-900'}`}>
                      {cfg.label}
                    </p>
                    {m && (
                      <time
                        dateTime={m.recordedAt}
                        className="text-xs text-slate-400 sm:flex-shrink-0"
                      >
                        {new Date(m.recordedAt).toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </time>
                    )}
                  </div>

                  {m?.notes && (
                    <p className="text-sm text-slate-500 mt-0.5">{m.notes}</p>
                  )}

                  {m?.stellarTxId && (
                    <p className="break-all text-xs text-slate-400 font-mono mt-0.5">
                      TX: {m.stellarTxId.slice(0, 20)}…
                    </p>
                  )}

                  {/* Geolocation link */}
                  {hasLocation && (
                    <MapLink lat={m!.latitude!} lng={m!.longitude!} />
                  )}

                  {/* Evidence thumbnails */}
                  {hasEvidence && (
                    <EvidenceThumbnails ids={m!.evidenceDocumentIds!} />
                  )}

                  {status === 'next' && !m && (
                    <p className="text-xs text-blue-500 mt-0.5 font-medium">Next milestone</p>
                  )}
                </div>
              </li>
            );
          })}

          {/* Extra milestones not in standard sequence */}
          {extraMilestones.map(m => (
            <li key={m.id} className="relative flex items-start gap-4">
              <div className="relative z-10 w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-sm flex-shrink-0" aria-label="Custom milestone">❓</div>
              <div className="flex-1 min-w-0 pt-1.5">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                  <p className="break-words text-sm font-semibold text-slate-900 capitalize">{m.milestone.replace(/_/g, ' ')}</p>
                  <time dateTime={m.recordedAt} className="text-xs text-slate-400">{new Date(m.recordedAt).toLocaleDateString()}</time>
                </div>
                {m.notes && <p className="text-sm text-slate-500 mt-0.5">{m.notes}</p>}
                {m.latitude != null && m.longitude != null && (
                  <MapLink lat={m.latitude} lng={m.longitude} />
                )}
                {(m.evidenceDocumentIds?.length ?? 0) > 0 && (
                  <EvidenceThumbnails ids={m.evidenceDocumentIds!} />
                )}
              </div>
            </li>
          ))}
        </ol>
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
      const token = getAuthToken();
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
    <div className={`max-w-full space-y-5 overflow-hidden ${className}`}>
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
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                    <p className={`break-words text-sm font-semibold ${status === 'pending' ? 'text-slate-400' : 'text-slate-900'}`}>
                      {cfg.label}
                    </p>
                    {m && (
                      <span className="text-xs text-slate-400 sm:flex-shrink-0">
                        {new Date(m.recordedAt).toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>

                  {m?.notes && (
                    <p className="text-sm text-slate-500 mt-0.5">{m.notes}</p>
                  )}
                  {m?.stellarTxId && (
                    <p className="break-all text-xs text-slate-400 font-mono mt-0.5">
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
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                  <p className="break-words text-sm font-semibold text-slate-900 capitalize">{m.milestone.replace(/_/g, ' ')}</p>
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
