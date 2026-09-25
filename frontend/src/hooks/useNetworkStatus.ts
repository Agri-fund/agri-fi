'use client';

/**
 * useNetworkStatus
 *
 * Listens to the browser's `online` and `offline` window events and returns
 * the current network connectivity state.
 *
 * SSR-safe: defaults to `true` (online) on the server where `navigator` is
 * not available.
 */

import { useEffect, useState } from 'react';

export interface NetworkStatus {
  /** `true` when the browser reports an active network connection. */
  isOnline: boolean;
}

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    // On the server (or during SSR hydration) navigator is unavailable.
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine;
  });

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return { isOnline };
}
