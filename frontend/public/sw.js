/**
 * AgriFi Service Worker — Web Push Notifications
 *
 * Handles background push events so users receive milestone and escrow
 * alerts even when the app tab is closed.
 */

/* global self, clients */

// ── Install: skip waiting so the new SW activates immediately ────────────────
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// ── Activate: claim any open clients right away ──────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// ── Push: display a notification for every incoming push message ─────────────
self.addEventListener('push', (event) => {
  let data = {
    title: 'AgriFi',
    body: 'You have a new notification.',
    icon: '/icon-192.png',
    badge: '/icon-badge.png',
    tag: 'agri-fi-push',
    url: '/',
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    } catch {
      // Payload may be plain text
      data.body = event.data.text();
    }
  }

  const { title, body, icon, badge, tag, url, ...rest } = data;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge,
      tag,
      data: { url, ...rest },
      requireInteraction: false,
      vibrate: [200, 100, 200],
    }),
  );
});

// ── Notification click: focus or open the relevant app URL ───────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : '/';

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // If a window with the target URL is already open, focus it
        for (const client of windowClients) {
          if (client.url === targetUrl && 'focus' in client) {
            return client.focus();
          }
        }
        // Otherwise open a new window
        if (clients.openWindow) {
          return clients.openWindow(targetUrl);
        }
      }),
  );
});
