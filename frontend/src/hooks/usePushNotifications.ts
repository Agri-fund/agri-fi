'use client';

import { useEffect, useRef } from 'react';
import {
  isPushSupported,
  registerPushNotifications,
} from '@/lib/pushNotifications';

/**
 * usePushNotifications
 *
 * Registers the service worker and requests push notification permission once
 * per session (the browser's own permission prompt handles subsequent visits).
 *
 * Drop this hook into any authenticated dashboard page — it is intentionally
 * side-effect-only and returns nothing.
 *
 * @param enabled Pass `false` to skip the request (e.g. while the user
 *   object is still loading). Defaults to `true`.
 */
export function usePushNotifications(enabled = true): void {
  const attempted = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (attempted.current) return;
    if (!isPushSupported()) return;

    attempted.current = true;

    // Fire-and-forget — we deliberately do NOT surface errors to the UI;
    // push notifications are an enhancement, not a critical path.
    registerPushNotifications().catch(() => {
      // Silently swallow failures (permission denied, network error, etc.)
    });
  }, [enabled]);
}
