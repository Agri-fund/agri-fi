'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiClient, User } from '@/lib/api';

type KycStatus = User['kycStatus'];

function dismissKey(userId: string): string {
  return `kyc_banner_dismissed_${userId}`;
}

/**
 * Issue #268 — Dashboard KYC status banner.
 *
 * Fetches the current user's verification status on mount (cached user
 * first, then revalidated) and renders advice appropriate to that status.
 * Only the "Approved" state is dismissible — pending/rejected/expired are
 * persistent reminders since they require the user to take action.
 */
export default function KycStatusBanner() {
  const [user, setUser] = useState<User | null>(() => apiClient.getCurrentUser());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    apiClient.refreshCurrentUser().then((fresh) => {
      if (active && fresh) setUser(fresh);
    }).catch(() => {
      // Keep showing the cached status if the revalidation fails.
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    setDismissed(localStorage.getItem(dismissKey(user.id)) === '1');
  }, [user?.id]);

  const dismiss = () => {
    if (user?.id) localStorage.setItem(dismissKey(user.id), '1');
    setDismissed(true);
  };

  // Admins aren't gated by KYC (they don't invest or list trade deals), so
  // the reminder isn't actionable for them.
  if (!user || user.role === 'admin') return null;

  const status: KycStatus = user.kycStatus;

  if (status === 'verified') {
    if (dismissed) return null;
    return (
      <div className="alert-success mb-6" role="status">
        <span aria-hidden="true">✅</span>
        <div className="flex-1">
          <p className="font-semibold">Identity verified</p>
          <p className="text-sm">You have full access to invest, trade, and withdraw on AgriFi.</p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss verification banner"
          className="text-emerald-700 hover:text-emerald-900 text-lg leading-none flex-shrink-0"
        >
          ×
        </button>
      </div>
    );
  }

  if (status === 'rejected') {
    return (
      <div className="alert-error mb-6" role="alert">
        <span aria-hidden="true">⚠</span>
        <div className="flex-1">
          <p className="font-semibold">Verification rejected</p>
          <p className="text-sm">
            We couldn&apos;t verify your identity documents. Please resubmit with clearer,
            unexpired documents, or contact support if you believe this is a mistake.
          </p>
          <div className="flex flex-wrap gap-3 mt-2 text-sm font-semibold">
            <Link href="/kyc" className="underline hover:no-underline">Resubmit documents</Link>
            <Link href="/help" className="underline hover:no-underline">Contact support</Link>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'expired') {
    return (
      <div className="alert-warning mb-6" role="alert">
        <span aria-hidden="true">⏳</span>
        <div className="flex-1">
          <p className="font-semibold">Verification expired</p>
          <p className="text-sm">
            Your KYC documents have expired and need to be resubmitted to keep trading on AgriFi.
          </p>
          <div className="flex flex-wrap gap-3 mt-2 text-sm font-semibold">
            <Link href="/kyc" className="underline hover:no-underline">Resubmit documents</Link>
            <Link href="/help" className="underline hover:no-underline">Contact support</Link>
          </div>
        </div>
      </div>
    );
  }

  // status === 'pending' (default for both "not yet submitted" and "under review")
  return (
    <div className="alert-warning mb-6" role="status">
      <span aria-hidden="true">🕒</span>
      <div className="flex-1">
        <p className="font-semibold">Verification under review</p>
        <p className="text-sm">
          KYC review typically takes 24–48 hours. If you haven&apos;t submitted your
          documents yet, complete verification now to unlock investing and trading.
        </p>
        <div className="flex flex-wrap gap-3 mt-2 text-sm font-semibold">
          <Link href="/kyc" className="underline hover:no-underline">Complete verification</Link>
          <Link href="/help" className="underline hover:no-underline">Contact support</Link>
        </div>
      </div>
    </div>
  );
}
