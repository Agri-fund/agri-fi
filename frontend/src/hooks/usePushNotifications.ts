'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  isPushSupported,
  getPushPermissionStatus,
  registerPushNotifications,
  optInToPush,
  optOutOfPush,
  CONCRETE_PUSH_EVENT_TYPES,
  ConcretePushEventType,
} from '@/lib/pushNotifications';

export interface UsePushNotificationsOptions {
  enabled?: boolean;
  eventTypes?: (ConcretePushEventType | string)[];
}

export interface UsePushNotificationsReturn {
  isSupported: boolean;
  permission: NotificationPermission | 'unsupported';
  isSubscribed: boolean;
  optIn: (types?: string[]) => Promise<boolean>;
  optOut: () => Promise<boolean>;
}

/**
 * usePushNotifications
 *
 * Registers the service worker and manages push notifications for concrete event types:
 *  - investment.confirmed
 *  - escrow.released
 *  - kyc.approved
 *
 * Can be used as a side-effect-only hook:
 *   usePushNotifications();
 * Or with control handlers:
 *   const { isSubscribed, optIn, optOut } = usePushNotifications();
 */
export function usePushNotifications(
  optionsOrEnabled: boolean | UsePushNotificationsOptions = true,
): UsePushNotificationsReturn {
  const options =
    typeof optionsOrEnabled === 'boolean'
      ? { enabled: optionsOrEnabled, eventTypes: [...CONCRETE_PUSH_EVENT_TYPES] }
      : {
          enabled: optionsOrEnabled.enabled ?? true,
          eventTypes: optionsOrEnabled.eventTypes ?? [...CONCRETE_PUSH_EVENT_TYPES],
        };

  const attempted = useRef(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const isSupported = isPushSupported();

  useEffect(() => {
    setPermission(getPushPermissionStatus());
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          setIsSubscribed(sub !== null);
        });
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!options.enabled) return;
    if (attempted.current) return;
    if (!isSupported) return;

    attempted.current = true;

    // Fire-and-forget default registration for high-value events
    registerPushNotifications(options.eventTypes).then((success) => {
      setIsSubscribed(success);
      setPermission(getPushPermissionStatus());
    }).catch(() => {
      // Silently swallow failures
    });
  }, [options.enabled, isSupported, options.eventTypes]);

  const optIn = useCallback(async (types?: string[]) => {
    const targetTypes = types ?? options.eventTypes;
    const success = await optInToPush(targetTypes);
    setIsSubscribed(success);
    setPermission(getPushPermissionStatus());
    return success;
  }, [options.eventTypes]);

  const optOut = useCallback(async () => {
    const success = await optOutOfPush();
    if (success) {
      setIsSubscribed(false);
    }
    return success;
  }, []);

  return {
    isSupported,
    permission,
    isSubscribed,
    optIn,
    optOut,
  };
}
