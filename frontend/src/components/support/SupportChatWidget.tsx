'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageSquare, Paperclip, ShieldCheck, X, Search } from 'lucide-react';
import { apiClient, apiFetchPublic, Deal, User } from '@/lib/api';
import { getAuthToken } from '@/lib/auth-token';

export type SupportChatProvider = 'crisp' | 'intercom';

export interface SupportChatWidgetProps {
  enabled?: boolean;
  provider?: string;
  websiteId?: string;
}

export interface SupportUserContext {
  name: string;
  email?: string;
  role: string;
  kycStatus: string;
  activeDealCount: number;
}

const GDPR_STORAGE_KEY = 'agrifi_support_gdpr_accepted';
const ACTIVE_DEAL_STATUSES = new Set(['open', 'funded', 'delivered', 'DISPUTED']);

declare global {
  interface Window {
    $crisp?: unknown[][];
    CRISP_WEBSITE_ID?: string;
    Intercom?: (...args: unknown[]) => void;
    intercomSettings?: Record<string, unknown>;
  }
}

export function isAuthRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return /^(\/[a-z]{2}(?:-[a-z]{2})?)?\/auth(\/|$)/i.test(pathname);
}

function resolveProvider(raw?: string): SupportChatProvider {
  const normalized = (
    raw ??
    process.env.NEXT_PUBLIC_SUPPORT_CHAT_PROVIDER ??
    'crisp'
  )
    .trim()
    .toLowerCase();
  return normalized === 'intercom' ? 'intercom' : 'crisp';
}

function resolveEnabled(propEnabled?: boolean): boolean {
  if (typeof propEnabled === 'boolean') return propEnabled;
  const envVal = process.env.NEXT_PUBLIC_SUPPORT_CHAT_ENABLED;
  if (envVal === undefined) return true;
  return envVal.trim().toLowerCase() !== 'false';
}

export const SupportChatWidget: React.FC<SupportChatWidgetProps> = ({
  enabled: propEnabled,
  provider: propProvider,
  websiteId: propWebsiteId,
}) => {
  const pathname = usePathname();
  const isEnabled = resolveEnabled(propEnabled);
  const provider = resolveProvider(propProvider);
  const websiteId =
    propWebsiteId ??
    (provider === 'intercom'
      ? process.env.NEXT_PUBLIC_INTERCOM_APP_ID ?? ''
      : process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID ?? '');

  const [isOpen, setIsOpen] = useState(false);
  const [gdprAccepted, setGdprAccepted] = useState(false);
  const [sdkInitialized, setSdkInitialized] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [userContext, setUserContext] = useState<SupportUserContext>({
    name: 'Guest',
    role: 'guest',
    kycStatus: 'unverified',
    activeDealCount: 0,
  });
  const [showDealPicker, setShowDealPicker] = useState(false);
  const [dealSearch, setDealSearch] = useState('');
  const [attachedDeal, setAttachedDeal] = useState<Deal | null>(null);

  const hidden = isAuthRoute(pathname);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setGdprAccepted(localStorage.getItem(GDPR_STORAGE_KEY) === 'true');
    } catch {
      setGdprAccepted(false);
    }
  }, []);

  const loadUserAndDeals = useCallback(async () => {
    if (hidden || !isEnabled) return;

    let currentUser: User | null = null;
    try {
      currentUser = apiClient.getCurrentUser();
      if (getAuthToken()) {
        const refreshed = await apiClient.refreshCurrentUser().catch(() => null);
        if (refreshed) {
          currentUser = refreshed;
        }
      }
    } catch {
      currentUser = null;
    }

    let userDeals: Deal[] = [];
    try {
      if (currentUser?.role === 'farmer') {
        userDeals = await apiClient.getFarmerDeals();
      } else if (currentUser?.role === 'trader') {
        userDeals = await apiClient.getTraderDeals();
      } else if (currentUser?.role === 'investor') {
        const investments = await apiClient.getInvestorInvestments();
        const unique = new Map<string, Deal>();
        for (const inv of investments) {
          if (inv.deal?.id) unique.set(inv.deal.id, inv.deal);
        }
        userDeals = Array.from(unique.values());
      } else if (getAuthToken()) {
        const publicDeals = await apiFetchPublic<Deal[] | { data: Deal[] }>(
          '/trade-deals',
        );
        userDeals = Array.isArray(publicDeals)
          ? publicDeals
          : publicDeals?.data ?? [];
      }
    } catch {
      userDeals = [];
    }

    const activeCount = userDeals.filter((d) =>
      ACTIVE_DEAL_STATUSES.has(d.status),
    ).length;

    setDeals(userDeals);
    setUserContext({
      name: currentUser?.name || currentUser?.email || 'Guest',
      email: currentUser?.email,
      role: currentUser?.role || 'guest',
      kycStatus: currentUser?.kycStatus || 'pending',
      activeDealCount: activeCount,
    });
  }, [hidden, isEnabled]);

  useEffect(() => {
    void loadUserAndDeals();
  }, [loadUserAndDeals]);

  const pushContextToProvider = useCallback(
    (ctx: SupportUserContext, deal: Deal | null) => {
      if (typeof window === 'undefined' || !isEnabled || !gdprAccepted) return;

      const sessionEntries: Array<[string, string]> = [
        ['user_name', ctx.name],
        ['role', ctx.role],
        ['kyc_status', ctx.kycStatus],
        ['active_deal_count', String(ctx.activeDealCount)],
      ];
      if (deal) {
        sessionEntries.push(['attached_deal_id', deal.id]);
        sessionEntries.push(['attached_deal_commodity', deal.commodity]);
        sessionEntries.push(['attached_deal_status', deal.status]);
      }

      if (provider === 'crisp') {
        window.$crisp = window.$crisp || [];
        window.$crisp.push(['set', 'user:nickname', [ctx.name]]);
        if (ctx.email) {
          window.$crisp.push(['set', 'user:email', [ctx.email]]);
        }
        window.$crisp.push(['set', 'session:data', [sessionEntries]]);
      } else if (provider === 'intercom') {
        const payload: Record<string, unknown> = {
          name: ctx.name,
          email: ctx.email,
          role: ctx.role,
          kyc_status: ctx.kycStatus,
          active_deal_count: ctx.activeDealCount,
        };
        if (deal) {
          payload.attached_deal_id = deal.id;
          payload.attached_deal_commodity = deal.commodity;
          payload.attached_deal_status = deal.status;
        }
        window.intercomSettings = {
          ...(window.intercomSettings ?? {}),
          ...payload,
        };
        if (typeof window.Intercom === 'function') {
          window.Intercom('update', payload);
        }
      }
    },
    [gdprAccepted, isEnabled, provider],
  );

  // Initialize provider SDK only when enabled, not on /auth/*, and GDPR accepted
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (hidden || !isEnabled || !gdprAccepted) return;

    if (!sdkInitialized) {
      if (provider === 'crisp') {
        window.$crisp = window.$crisp || [];
        if (websiteId) {
          window.CRISP_WEBSITE_ID = websiteId;
          if (!document.querySelector('script[data-support-sdk="crisp"]')) {
            const script = document.createElement('script');
            script.src = 'https://client.crisp.chat/l.js';
            script.async = true;
            script.dataset.supportSdk = 'crisp';
            document.head.appendChild(script);
          }
        }
      } else if (provider === 'intercom') {
        if (websiteId) {
          window.intercomSettings = {
            ...(window.intercomSettings ?? {}),
            app_id: websiteId,
          };
          if (!document.querySelector('script[data-support-sdk="intercom"]')) {
            const script = document.createElement('script');
            script.src = `https://widget.intercom.io/widget/${encodeURIComponent(websiteId)}`;
            script.async = true;
            script.dataset.supportSdk = 'intercom';
            document.head.appendChild(script);
          }
        }
      }
      setSdkInitialized(true);
    }

    pushContextToProvider(userContext, attachedDeal);
  }, [
    attachedDeal,
    gdprAccepted,
    hidden,
    isEnabled,
    provider,
    pushContextToProvider,
    sdkInitialized,
    userContext,
    websiteId,
  ]);

  const handleAcceptGdpr = () => {
    try {
      localStorage.setItem(GDPR_STORAGE_KEY, 'true');
    } catch {
      // ignore storage errors
    }
    setGdprAccepted(true);
  };

  const handleAttachDeal = (deal: Deal) => {
    setAttachedDeal(deal);
    setShowDealPicker(false);
    pushContextToProvider(userContext, deal);
  };

  const handleDetachDeal = () => {
    setAttachedDeal(null);
    pushContextToProvider(userContext, null);
  };

  const filteredDeals = useMemo(() => {
    const q = dealSearch.trim().toLowerCase();
    if (!q) return deals;
    return deals.filter(
      (d) =>
        d.id.toLowerCase().includes(q) ||
        d.commodity.toLowerCase().includes(q) ||
        (d.title ?? '').toLowerCase().includes(q) ||
        (d.token_symbol ?? '').toLowerCase().includes(q),
    );
  }, [dealSearch, deals]);

  if (hidden) {
    return null;
  }

  if (!isEnabled) {
    return (
      <div
        data-testid="support-unavailable-notice"
        role="status"
        className="fixed bottom-4 left-4 z-40 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 px-4 py-2.5 shadow-md text-xs font-medium text-slate-600 dark:text-slate-300"
      >
        Support unavailable
      </div>
    );
  }

  return (
    <div data-testid="support-chat-widget" className="fixed bottom-4 left-4 z-40">
      {!isOpen ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Open live support chat"
          className="inline-flex items-center gap-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 text-sm font-semibold shadow-lg transition-colors"
        >
          <MessageSquare className="w-4 h-4" aria-hidden="true" />
          <span>Support</span>
        </button>
      ) : (
        <div className="w-80 sm:w-96 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between bg-emerald-600 px-4 py-3 text-white">
            <div>
              <h2 className="text-sm font-bold">AgriFi Live Support</h2>
              <p className="text-[11px] text-emerald-100">
                Provider: {provider === 'intercom' ? 'Intercom' : 'Crisp'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close support chat"
              className="rounded-lg p-1 hover:bg-emerald-700 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Pre-filled User Context Sidebar Preview */}
          <div
            data-testid="support-user-context"
            className="border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 px-4 py-2.5 text-xs space-y-1"
          >
            <div className="flex justify-between">
              <span className="text-slate-500">Name</span>
              <span className="font-semibold text-slate-800 dark:text-slate-100">
                {userContext.name}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Role / KYC</span>
              <span className="font-medium text-slate-700 dark:text-slate-200">
                {userContext.role} / {userContext.kycStatus}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Active Deals</span>
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                {userContext.activeDealCount}
              </span>
            </div>
          </div>

          {/* Body: GDPR gate or Active Session */}
          {!gdprAccepted ? (
            <div data-testid="support-gdpr-notice" className="p-4 space-y-3">
              <div className="flex items-start gap-2.5">
                <ShieldCheck
                  className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div className="space-y-1.5">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    GDPR Data Processing Notice
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    Before starting your first chat session, please confirm you
                    consent to sharing your profile name, role, KYC status,
                    active deal count, and any deal ID you attach with AgriFi
                    support agents in accordance with our{' '}
                    <Link
                      href="/privacy"
                      className="text-emerald-600 underline font-medium"
                    >
                      Privacy Policy
                    </Link>
                    .
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleAcceptGdpr}
                className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold py-2.5 transition-colors"
              >
                Accept &amp; Start Chat
              </button>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Your session is active. Support agents can see your account
                context and any deal you attach below.
              </p>

              {attachedDeal && (
                <div
                  data-testid="attached-deal-badge"
                  className="flex items-center justify-between rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-emerald-900 dark:text-emerald-200 truncate">
                      Attached Deal: {attachedDeal.title || attachedDeal.commodity}
                    </p>
                    <p className="font-mono text-[11px] text-emerald-700 dark:text-emerald-400 truncate">
                      {attachedDeal.id}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleDetachDeal}
                    className="ml-2 text-emerald-700 hover:text-emerald-900 text-[11px] font-semibold"
                  >
                    Remove
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowDealPicker((prev) => !prev)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 transition-colors"
              >
                <Paperclip className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Attach Deal</span>
              </button>

              {showDealPicker && (
                <div
                  data-testid="support-deal-picker"
                  className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 space-y-2"
                >
                  <div className="relative">
                    <Search
                      className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2"
                      aria-hidden="true"
                    />
                    <input
                      type="text"
                      value={dealSearch}
                      onChange={(e) => setDealSearch(e.target.value)}
                      placeholder="Search deals by commodity or ID..."
                      aria-label="Search deals"
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pl-8 pr-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredDeals.length === 0 ? (
                      <p className="py-3 text-center text-xs text-slate-400">
                        No deals found
                      </p>
                    ) : (
                      filteredDeals.map((deal) => (
                        <button
                          key={deal.id}
                          type="button"
                          onClick={() => handleAttachDeal(deal)}
                          className="w-full text-left py-2 px-1.5 hover:bg-emerald-50 dark:hover:bg-slate-800 rounded transition-colors"
                        >
                          <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                            {deal.title || deal.commodity}
                          </p>
                          <p className="text-[11px] text-slate-500 font-mono truncate">
                            {deal.id} ({deal.status})
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SupportChatWidget;
