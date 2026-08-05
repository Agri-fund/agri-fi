'use client';

/**
 * OfflineBanner
 *
 * Fixed banner that appears when the browser goes offline.
 * Uses semantic HTML (role="alert") and accessible markup.
 * Includes visual flags (icon, color) and uses i18n keys from next-intl.
 */

import { useTranslations } from 'next-intl';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';

export default function OfflineBanner() {
  const t = useTranslations('common');
  const { isOnline } = useNetworkStatus();

  // Only render the banner when offline
  if (isOnline) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="fixed top-0 left-0 right-0 z-[200] bg-amber-500 text-white px-4 py-3 shadow-lg border-b-2 border-amber-600 animate-slide-down"
    >
      <div className="max-w-screen-xl mx-auto flex items-center justify-center gap-3">
        {/* Icon: Offline/wifi-off */}
        <svg
          className="w-5 h-5 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"
          />
        </svg>

        <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2">
          <p className="text-sm font-semibold">{t('network.offline.title')}</p>
          <p className="text-xs font-medium opacity-90">
            {t('network.offline.description')}
          </p>
        </div>
      </div>
    </div>
  );
}
