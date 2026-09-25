/**
 * pushNotifications.ts
 *
 * Browser-side utilities for registering the service worker, requesting push
 * permission, managing PushSubscription objects, and persisting them to the
 * backend so the server can deliver Web Push messages.
 *
 * Usage (inside a dashboard useEffect / button handler):
 *   import { registerPushNotifications } from '@/lib/pushNotifications';
 *   await registerPushNotifications();
 */

const SW_PATH = '/sw.js';
const API_BASE = 'http://localhost:3001';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true when the browser supports service workers and the Push API.
 */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

/**
 * Returns the current browser permission state for notifications.
 */
export function getPushPermissionStatus(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }

  return Notification.permission;
}

/**
 * Converts a VAPID public key (Base64url string) to the Uint8Array format
 * required by `PushManager.subscribe`.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

/**
 * Retrieves the auth token stored by the login flow.
 */
function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token');
}

// ── Service Worker registration ───────────────────────────────────────────────

/**
 * Registers the service worker (or returns the existing registration).
 * Resolves to `null` when service workers are not supported.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;

  try {
    const registration = await navigator.serviceWorker.register(SW_PATH, {
      scope: '/',
    });
    return registration;
  } catch (err) {
    console.error('[PushNotifications] Service worker registration failed:', err);
    return null;
  }
}

// ── Permission request ────────────────────────────────────────────────────────

/**
 * Requests notification permission from the user.
 *
 * Returns `'granted'`, `'denied'`, or `'default'`.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }

  if (Notification.permission !== 'default') {
    return Notification.permission;
  }

  return Notification.requestPermission();
}

export const CONCRETE_PUSH_EVENT_TYPES = [
  'investment.confirmed',
  'escrow.released',
  'kyc.approved',
] as const;

export type ConcretePushEventType = (typeof CONCRETE_PUSH_EVENT_TYPES)[number];

// ── Subscribe to push ─────────────────────────────────────────────────────────

/**
 * Subscribes the browser to the push service using the provided VAPID public
 * key, then persists the `PushSubscription` object to the backend with registered event types.
 *
 * When `vapidPublicKey` is not supplied the function reads
 * `NEXT_PUBLIC_VAPID_PUBLIC_KEY` from the environment.
 */
export async function subscribeToPush(
  vapidPublicKey?: string,
  eventTypes: string[] = [...CONCRETE_PUSH_EVENT_TYPES],
): Promise<PushSubscription | null> {
  const key =
    vapidPublicKey ??
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  if (!key) {
    console.warn(
      '[PushNotifications] NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set. ' +
      'Push subscription skipped.',
    );
    return null;
  }

  const registration = await registerServiceWorker();
  if (!registration) return null;

  // Wait for the service worker to become active
  await navigator.serviceWorker.ready;

  try {
    const existingSubscription = await registration.pushManager.getSubscription();
    if (existingSubscription) {
      // Already subscribed — ensure it is stored on the backend with latest eventTypes
      await saveSubscriptionToServer(existingSubscription, eventTypes);
      return existingSubscription;
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });

    await saveSubscriptionToServer(subscription, eventTypes);
    return subscription;
  } catch (err) {
    console.error('[PushNotifications] Push subscription failed:', err);
    return null;
  }
}

// ── Unsubscribe ───────────────────────────────────────────────────────────────

/**
 * Unsubscribes the current push subscription and removes it from the backend.
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
  if (!registration) return false;

  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;

  try {
    await removeSubscriptionFromServer(subscription);
    const unsubscribed = await subscription.unsubscribe();
    return unsubscribed;
  } catch (err) {
    console.error('[PushNotifications] Unsubscribe failed:', err);
    return false;
  }
}

// ── Backend persistence ───────────────────────────────────────────────────────

/**
 * Sends the serialised PushSubscription to `POST /notifications/push/subscribe`
 * so the backend can deliver Web Push messages for enabled event types.
 */
async function saveSubscriptionToServer(
  subscription: PushSubscription,
  eventTypes: string[] = [...CONCRETE_PUSH_EVENT_TYPES],
): Promise<void> {
  const token = getAuthToken();
  if (!token) return; // user is not logged in; nothing to persist

  try {
    const payload = {
      ...subscription.toJSON(),
      eventTypes,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    };

    const res = await fetch(`${API_BASE}/notifications/push/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.warn(
        '[PushNotifications] Failed to save subscription:',
        res.status,
        res.statusText,
      );
    }
  } catch (err) {
    console.error('[PushNotifications] Error saving subscription to server:', err);
  }
}

/**
 * Notifies the backend that a push subscription has been cancelled so it can
 * remove the endpoint from its database.
 */
async function removeSubscriptionFromServer(
  subscription: PushSubscription,
): Promise<void> {
  const token = getAuthToken();
  if (!token) return;

  try {
    await fetch(`${API_BASE}/notifications/push/unsubscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
  } catch (err) {
    console.error('[PushNotifications] Error removing subscription from server:', err);
  }
}

// ── High-level convenience ────────────────────────────────────────────────────

/**
 * One-call entry point for dashboard pages.
 *
 * 1. Checks browser support.
 * 2. Requests notification permission (prompt shown once; subsequent calls
 *    respect the stored browser preference).
 * 3. Registers the service worker.
 * 4. Subscribes to push and persists the subscription with concrete event types to the backend.
 *
 * Returns `true` if the user is now subscribed, `false` otherwise.
 */
export async function registerPushNotifications(
  eventTypes: string[] = [...CONCRETE_PUSH_EVENT_TYPES],
): Promise<boolean> {
  if (!isPushSupported()) return false;

  const permission = await requestNotificationPermission();
  if (permission !== 'granted') return false;

  const subscription = await subscribeToPush(undefined, eventTypes);
  return subscription !== null;
}

/**
 * Explicit user opt-in handler. Registers service worker, requests permission,
 * and sets up subscription for concrete event types.
 */
export async function optInToPush(
  eventTypes: string[] = [...CONCRETE_PUSH_EVENT_TYPES],
): Promise<boolean> {
  return registerPushNotifications(eventTypes);
}

/**
 * Explicit user opt-out handler. Removes subscription on backend and browser.
 */
export async function optOutOfPush(): Promise<boolean> {
  return unsubscribeFromPush();
}
