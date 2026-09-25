'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { io, Socket } from 'socket.io-client';
import { getStoredToken } from '@/lib/api';

export interface NotificationItem {
  id: string;
  type: 'payment' | 'kyc' | 'deal' | 'alert';
  title: string;
  message: string;
  linkUrl?: string;
  notificationReadAt?: string | null;
  createdAt: string;
}

function getRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function NotificationIcon({ type }: { type: NotificationItem['type'] }) {
  switch (type) {
    case 'payment':
      return (
        <span className="w-8 h-8 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-sm flex-shrink-0">
          🪙
        </span>
      );
    case 'kyc':
      return (
        <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm flex-shrink-0">
          🛡️
        </span>
      );
    case 'deal':
      return (
        <span className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-sm flex-shrink-0">
          🌱
        </span>
      );
    case 'alert':
    default:
      return (
        <span className="w-8 h-8 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-sm flex-shrink-0">
          ⚠️
        </span>
      );
  }
}

export const NotificationBell: React.FC = () => {
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const token = getStoredToken();
      if (!token) return;
      const res = await fetch('/api/notifications?limit=10', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
      }
    } catch (err) {
      console.error('Failed to fetch notifications', err);
    }
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const token = getStoredToken();
      if (!token) return;
      const res = await fetch('/api/notifications?unread=true', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(Array.isArray(data) ? data.length : 0);
      }
    } catch (err) {
      console.error('Failed to fetch unread count', err);
    }
  }, []);

  const markAllAsRead = async () => {
    try {
      const token = getStoredToken();
      if (!token) return;
      await fetch('/api/notifications/mark-read', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      setUnreadCount(0);
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, notificationReadAt: new Date().toISOString() })),
      );
    } catch (err) {
      console.error('Failed to mark notifications read', err);
    }
  };

  const markItemAsRead = async (id: string) => {
    try {
      const token = getStoredToken();
      if (!token) return;
      await fetch('/api/notifications/mark-read', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ids: [id] }),
      });
      setUnreadCount((prev) => Math.max(0, prev - 1));
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, notificationReadAt: new Date().toISOString() } : n,
        ),
      );
    } catch (err) {
      console.error('Failed to mark item read', err);
    }
  };

  useEffect(() => {
    fetchUnreadCount();
    fetchNotifications();

    const token = getStoredToken();
    if (token) {
      const socket = io('/notifications', {
        auth: { token },
        transports: ['websocket'],
      });

      socket.on('handshake_response', (data: { unreadCount: number }) => {
        setUnreadCount(data.unreadCount ?? 0);
      });

      socket.on('unread_count', (data: { count: number }) => {
        setUnreadCount(data.count ?? 0);
      });

      socket.on('new_notification', (newNotif: NotificationItem) => {
        setUnreadCount((prev) => prev + 1);
        setNotifications((prev) => [newNotif, ...prev.slice(0, 9)]);
      });

      socketRef.current = socket;

      return () => {
        socket.disconnect();
      };
    }
  }, [fetchNotifications, fetchUnreadCount]);

  // Keyboard trap & click outside
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const toggleDropdown = () => {
    if (!isOpen) {
      markAllAsRead();
    }
    setIsOpen(!isOpen);
  };

  const badgeText = unreadCount > 99 ? '99+' : unreadCount.toString();

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <button
        onClick={toggleDropdown}
        aria-label={`Notifications, ${unreadCount} unread`}
        className="relative p-2 rounded-xl text-slate-600 hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>

        {unreadCount > 0 && (
          <span
            aria-live="polite"
            className="absolute top-1 right-1 px-1.5 py-0.5 text-[10px] font-bold text-white bg-red-500 rounded-full min-w-[1.25rem] text-center shadow-sm animate-pulse"
          >
            {badgeText}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Notifications Dropdown"
          className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-slate-100 z-[100] overflow-hidden transition-all duration-200"
        >
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <h4 className="font-bold text-slate-900 text-sm">Notifications</h4>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-xs text-emerald-600 font-semibold hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
            {notifications.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                No notifications yet
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => markItemAsRead(n.id)}
                  className={`p-3.5 flex items-start gap-3 transition-colors cursor-pointer hover:bg-slate-50 ${
                    !n.notificationReadAt ? 'bg-emerald-50/40' : ''
                  }`}
                >
                  <NotificationIcon type={n.type} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-slate-900 truncate">
                        {n.title}
                      </p>
                      <span className="text-[10px] text-slate-400 flex-shrink-0 ml-2">
                        {getRelativeTime(n.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">
                      {n.message}
                    </p>
                    {n.linkUrl && (
                      <Link
                        href={n.linkUrl}
                        className="inline-block text-[11px] font-semibold text-emerald-600 mt-1 hover:underline"
                      >
                        View detail →
                      </Link>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-3 border-t border-slate-100 bg-slate-50 text-center">
            <Link
              href="/notifications"
              onClick={() => setIsOpen(false)}
              className="text-xs font-semibold text-emerald-600 hover:text-emerald-700"
            >
              View all notifications →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};
