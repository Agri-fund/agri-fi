/**
 * AgriFi Service Worker — Offline-First Caching & Web Push Notifications
 *
 * Implements:
 * - Cache-first strategy for static assets (images, fonts, CSS, JS)
 * - Stale-while-revalidate for API read endpoints (deals, investments)
 * - Network-first for critical resources (HTML)
 * - Web push notifications for milestones and escrow alerts
 * - Cache invalidation on logout
 */

/* global self, clients */

const CACHE_NAME = "agri-fi-v1";
const RUNTIME_CACHE = "agri-fi-runtime-v1";
const API_CACHE = "agri-fi-api-v1";
const OFFLINE_URL = "/offline.html";

// Assets to cache on install (app shell)
const STATIC_ASSETS = [
  "/",
  "/offline.html",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.json",
];

// API endpoints that support stale-while-revalidate (read-only operations)
const CACHEABLE_API_PATTERNS = [
  /^\/api\/v\d+\/trade-deals/,
  /^\/api\/v\d+\/investments/,
  /^\/api\/v\d+\/users\/notifications/,
  /^\/api\/v\d+\/dashboard/,
  /^\/api\/v\d+\/marketplace/,
];

// ── Install: cache static assets and skip waiting ────────────────────────────
self.addEventListener("install", (event) => {
  console.log("[SW] Install event");

  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        console.log("[SW] Caching app shell");
        return cache.addAll(STATIC_ASSETS);
      })
      .catch((err) => {
        console.warn("[SW] Cache addAll failed:", err);
      }),
  );

  self.skipWaiting();
});

// ── Activate: cleanup old caches and claim clients ──────────────────────────
self.addEventListener("activate", (event) => {
  console.log("[SW] Activate event");

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (
            cacheName !== CACHE_NAME &&
            cacheName !== RUNTIME_CACHE &&
            cacheName !== API_CACHE
          ) {
            console.log("[SW] Deleting old cache:", cacheName);
            return caches.delete(cacheName);
          }
        }),
      );
    }),
  );

  return clients.claim();
});

// ── Message: handle cache invalidation and other commands from client ────────
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CLEAR_CACHE") {
    console.log("[SW] Clear cache command received");
    event.waitUntil(
      Promise.all([
        caches.delete(API_CACHE),
        caches.delete(RUNTIME_CACHE),
      ]).then(() => {
        console.log("[SW] Caches cleared on logout");
      }),
    );
  }
});

// ── Fetch: route requests to appropriate caching strategy ────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== "GET") {
    return;
  }

  // Skip chrome extensions and other non-http(s) requests
  if (!url.protocol.startsWith("http")) {
    return;
  }

  // API calls: stale-while-revalidate for cacheable read endpoints
  if (isCacheableApiEndpoint(url.pathname)) {
    event.respondWith(staleWhileRevalidateStrategy(request));
    return;
  }

  // API calls (other): network-first with offline fallback
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }

  // Static assets (JS, CSS, images, fonts): cache-first
  if (
    url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot)$/)
  ) {
    event.respondWith(cacheFirstStrategy(request));
    return;
  }

  // Documents (HTML): network-first with cache fallback
  event.respondWith(networkFirstStrategy(request));
});

// ── Check if API endpoint is cacheable ────────────────────────────────────────
function isCacheableApiEndpoint(pathname) {
  return CACHEABLE_API_PATTERNS.some((pattern) => pattern.test(pathname));
}

// ── Stale-while-revalidate: return cache immediately, update in background ────
async function staleWhileRevalidateStrategy(request) {
  const cache = await caches.open(API_CACHE);
  const cachedResponse = await cache.match(request);

  // Return cached response immediately while fetching in background
  const fetchPromise = fetch(request)
    .then((response) => {
      // Cache successful responses
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => {
      // Network failed, but we already returned cached response above
      return cachedResponse;
    });

  // Return cached response immediately (or fetch if no cache)
  return cachedResponse || fetchPromise;
}

// ── Network-first strategy: try network, fallback to cache or offline page ────
async function networkFirstStrategy(request) {
  try {
    const response = await fetch(request);

    // Cache successful responses for future use
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    console.log("[SW] Network request failed, trying cache:", request.url);

    // Try cache
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // Return offline page for navigation requests
    if (request.mode === "navigate") {
      return (
        caches.match(OFFLINE_URL) ||
        new Response("You are offline", {
          status: 503,
          statusText: "Service Unavailable",
          headers: new Headers({
            "Content-Type": "text/plain",
          }),
        })
      );
    }

    // Return 503 error response for other requests
    return new Response("Network unavailable", {
      status: 503,
      statusText: "Service Unavailable",
      headers: new Headers({
        "Content-Type": "text/plain",
      }),
    });
  }
}

// ── Cache-first strategy: try cache, fallback to network ──────────────────────
async function cacheFirstStrategy(request) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    console.log("[SW] Cache and network both failed:", request.url);

    // Return a placeholder response for failed static assets
    if (request.destination === "image") {
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect fill="#ccc"/></svg>',
        { headers: { "Content-Type": "image/svg+xml" } },
      );
    }

    return new Response("Asset unavailable", {
      status: 503,
      statusText: "Service Unavailable",
    });
  }
}

// ── Push: display a notification for every incoming push message ─────────────
self.addEventListener("push", (event) => {
  let data = {
    title: "AgriFi",
    body: "You have a new notification.",
    icon: "/icon-192.png",
    badge: "/icon-badge.png",
    tag: "agri-fi-push",
    url: "/",
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
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl =
    event.notification.data && event.notification.data.url
      ? event.notification.data.url
      : "/";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // If a window with the target URL is already open, focus it
        for (const client of windowClients) {
          if (client.url === targetUrl && "focus" in client) {
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
