'use client';
/**
 * ActivityFeed — Issue #863
 *
 * Displays a cursor-paginated, reverse-chronological activity feed for a
 * trade deal. Polls for new events every 15 seconds so fresh events appear
 * at the top without a page refresh (lightweight alternative to WebSocket
 * for Next.js App Router server-component pages).
 *
 * Privacy: investor amounts are already anonymised server-side for
 * non-admin viewers; this component simply renders whatever the API returns.
 *
 * i18n: all display strings come from the "activityFeed" namespace in the
 * next-intl message files.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetchPublic } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ActivityEventType =
  | 'investor_joined'
  | 'shipment_milestone'
  | 'funding_target_met'
  | 'payment_distributed'
  | 'document_uploaded'
  | 'deal_status_changed';

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  description: string;
  createdAt: string;
  meta: Record<string, unknown>;
}

interface ActivityFeedResponse {
  events: ActivityEvent[];
  nextCursor: string | null;
  total: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 15_000;

const EVENT_ICONS: Record<ActivityEventType, string> = {
  investor_joined:      '👤',
  shipment_milestone:   '🚢',
  funding_target_met:   '🎯',
  payment_distributed:  '💰',
  document_uploaded:    '📄',
  deal_status_changed:  '🔄',
};

const EVENT_COLORS: Record<ActivityEventType, string> = {
  investor_joined:      'bg-blue-50 border-blue-200 text-blue-700',
  shipment_milestone:   'bg-emerald-50 border-emerald-200 text-emerald-700',
  funding_target_met:   'bg-brand-50 border-brand-200 text-brand-700',
  payment_distributed:  'bg-green-50 border-green-200 text-green-700',
  document_uploaded:    'bg-amber-50 border-amber-200 text-amber-700',
  deal_status_changed:  'bg-slate-50 border-slate-200 text-slate-600',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1)  return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)   return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7)     return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ActivityFeedProps {
  tradeDealId: string;
  /** If true shows admin-level detail (amounts not masked). */
  isAdmin?: boolean;
  className?: string;
}

export const ActivityFeed: React.FC<ActivityFeedProps> = ({
  tradeDealId,
  isAdmin = false,
  className = '',
}) => {
  const t = useTranslations('activityFeed');

  const [events, setEvents]       = useState<ActivityEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [newCount, setNewCount]   = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestCursorRef = useRef<string | null>(null);

  // ── Fetcher ──────────────────────────────────────────────────────────────

  const fetchPage = useCallback(
    async (cursor?: string): Promise<ActivityFeedResponse | null> => {
      try {
        const params = new URLSearchParams({ limit: '20' });
        if (cursor) params.set('cursor', cursor);
        return await apiFetchPublic<ActivityFeedResponse>(
          `/trade-deals/${tradeDealId}/activity?${params.toString()}`,
        );
      } catch (err) {
        console.error('ActivityFeed fetch error:', err);
        return null;
      }
    },
    [tradeDealId],
  );

  // ── Initial load ──────────────────────────────────────────────────────────

  const initialLoad = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchPage();
    if (!result) {
      setError(t('loadError'));
    } else {
      setEvents(result.events);
      setNextCursor(result.nextCursor);
    }
    setLoading(false);
  }, [fetchPage, t]);

  // ── Polling for new events ────────────────────────────────────────────────

  const poll = useCallback(async () => {
    // Fetch first page (no cursor = latest events)
    const result = await fetchPage();
    if (!result || result.events.length === 0) return;

    setEvents((prev) => {
      const existingIds = new Set(prev.map((e) => e.id));
      const fresh = result.events.filter((e) => !existingIds.has(e.id));
      if (fresh.length === 0) return prev;
      setNewCount((n) => n + fresh.length);
      // Prepend newest events; keep list sorted DESC
      return [...fresh, ...prev].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    });
  }, [fetchPage]);

  useEffect(() => {
    void initialLoad();
  }, [initialLoad]);

  useEffect(() => {
    pollRef.current = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [poll]);

  // ── Load more (cursor-based) ──────────────────────────────────────────────

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const result = await fetchPage(nextCursor);
    if (result) {
      setEvents((prev) => {
        const existingIds = new Set(prev.map((e) => e.id));
        const fresh = result.events.filter((e) => !existingIds.has(e.id));
        return [...prev, ...fresh].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      });
      setNextCursor(result.nextCursor);
    }
    setLoadingMore(false);
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderEventMeta = (event: ActivityEvent) => {
    const { type, meta } = event;
    if (type === 'shipment_milestone' && meta.notes) {
      return <p className="text-xs text-slate-400 mt-1 italic">"{String(meta.notes)}"</p>;
    }
    if (type === 'investor_joined' && isAdmin && meta.amountUsd) {
      return (
        <p className="text-xs text-slate-400 mt-1">
          Amount: <span className="font-medium text-slate-600">${Number(meta.amountUsd).toLocaleString()}</span>
        </p>
      );
    }
    if (type === 'deal_status_changed' && meta.newStatus) {
      return (
        <p className="text-xs text-slate-400 mt-1">
          New status:{' '}
          <span className="badge-blue text-[10px] px-1.5 py-0.5 capitalize">
            {String(meta.newStatus)}
          </span>
        </p>
      );
    }
    if (type === 'document_uploaded' && meta.docType) {
      return (
        <p className="text-xs text-slate-400 mt-1 capitalize">
          {String(meta.docType).replace(/_/g, ' ')}
        </p>
      );
    }
    return null;
  };

  // ── Loading skeleton ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className={`space-y-4 ${className}`}>
        <div className="flex items-center justify-between">
          <div className="h-5 w-32 skeleton rounded-lg" />
        </div>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="w-8 h-8 skeleton rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 skeleton rounded-lg w-3/4" />
              <div className="h-3 skeleton rounded-lg w-1/4" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className={`alert-error ${className}`}>
        <span>⚠</span>
        <div>
          <p>{error}</p>
          <button onClick={initialLoad} className="underline text-xs mt-1">
            {t('retry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="section-title">{t('title')}</h3>
        {newCount > 0 && (
          <span
            className="badge-blue text-xs px-2 py-0.5 cursor-pointer"
            onClick={() => setNewCount(0)}
            title={t('dismissNew')}
          >
            +{newCount} {t('new')}
          </span>
        )}
      </div>

      {/* Empty state */}
      {events.length === 0 && (
        <div className="text-center py-10">
          <p className="text-3xl mb-2">📋</p>
          <p className="text-sm text-slate-400">{t('empty')}</p>
          <p className="text-xs text-slate-300 mt-1">{t('emptyHint')}</p>
        </div>
      )}

      {/* Event list */}
      {events.length > 0 && (
        <div className="relative">
          {/* Vertical connector */}
          <div className="absolute left-[15px] top-4 bottom-4 w-px bg-slate-100" />

          <ol className="space-y-4" aria-label={t('title')}>
            {events.map((event) => {
              const colorClass = EVENT_COLORS[event.type] ?? 'bg-slate-50 border-slate-200 text-slate-600';
              return (
                <li key={event.id} className="relative flex items-start gap-3">
                  {/* Icon dot */}
                  <div
                    className={`relative z-10 w-8 h-8 rounded-full border flex items-center justify-center text-sm flex-shrink-0 ${colorClass}`}
                    aria-hidden="true"
                  >
                    {EVENT_ICONS[event.type] ?? '📌'}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pt-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-slate-800 leading-snug">
                        {event.description}
                      </p>
                      <time
                        dateTime={event.createdAt}
                        className="text-[11px] text-slate-400 flex-shrink-0 whitespace-nowrap"
                        title={new Date(event.createdAt).toLocaleString()}
                      >
                        {relativeTime(event.createdAt)}
                      </time>
                    </div>
                    {renderEventMeta(event)}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Load more */}
      {nextCursor && (
        <div className="text-center pt-2">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="btn-secondary text-sm px-4 py-2 disabled:opacity-50"
            aria-live="polite"
          >
            {loadingMore ? t('loading') : t('loadMore')}
          </button>
        </div>
      )}
    </div>
  );
};

export default ActivityFeed;
