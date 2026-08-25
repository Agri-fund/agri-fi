'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getStoredToken } from '@/lib/api';
import { NotificationItem } from '@/components/navigation/NotificationBell';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const token = getStoredToken();
        if (!token) return;
        const res = await fetch('/api/notifications?limit=50', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setNotifications(data);
        }
      } catch (err) {
        console.error('Failed to load full notifications page', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">All Notifications</h1>
        <Link
          href="/dashboard"
          className="text-sm font-semibold text-emerald-600 hover:underline"
        >
          ← Back to Dashboard
        </Link>
      </div>

      {loading ? (
        <div className="p-8 text-center text-slate-400">Loading notifications...</div>
      ) : notifications.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-100 shadow-sm text-slate-400">
          No notifications found.
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-100 overflow-hidden">
          {notifications.map((n) => (
            <div key={n.id} className="p-4 flex items-start gap-4 hover:bg-slate-50 transition-colors">
              <div className="text-xl">
                {n.type === 'payment'
                  ? '🪙'
                  : n.type === 'kyc'
                  ? '🛡️'
                  : n.type === 'deal'
                  ? '🌱'
                  : '⚠️'}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 text-sm">{n.title}</h3>
                  <span className="text-xs text-slate-400">
                    {new Date(n.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-1">{n.message}</p>
                {n.linkUrl && (
                  <Link
                    href={n.linkUrl}
                    className="inline-block text-xs font-semibold text-emerald-600 mt-2 hover:underline"
                  >
                    View Details →
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
