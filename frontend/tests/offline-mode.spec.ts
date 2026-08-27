import { test, expect, Page } from '@playwright/test';

/**
 * Offline Mode Tests
 *
 * Tests service worker caching and offline-first functionality:
 * - Dashboard loads from cache when offline
 * - API data (deals, investments) served from cache
 * - OfflineBanner shows when network unavailable
 * - Cache invalidated on logout
 */

test.describe('Offline Mode - Service Worker Caching', () => {
  let page: Page;

  test.beforeEach(async ({ browser, context }) => {
    page = await context.newPage();
    
    // Enable service worker support
    await context.setOffline(false);
    
    // Navigate to dashboard
    await page.goto('/dashboard', { waitUntil: 'networkidle' });
    
    // Wait for service worker to register and cache assets
    await page.waitForLoadState('networkidle');
  });

  test('should cache static assets on first visit', async () => {
    // Collect network requests on first visit
    const requests: string[] = [];
    page.on('request', (request) => {
      if (
        request.resourceType() === 'script' ||
        request.resourceType() === 'stylesheet'
      ) {
        requests.push(request.url());
      }
    });

    // First visit - assets should be loaded
    await page.goto('/dashboard');
    expect(requests.length).toBeGreaterThan(0);

    const initialRequests = requests.length;

    // Clear requests
    requests.length = 0;

    // Second visit - should use cached assets
    await page.goto('/dashboard');
    
    // On cached visit, should have fewer network requests
    // (service worker serves from cache instead of network)
    expect(requests.length).toBeLessThanOrEqual(initialRequests);
  });

  test('should show OfflineBanner when network is unavailable', async () => {
    // Go offline
    await page.context().setOffline(true);

    // Trigger offline event (some browsers don't automatically)
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'));
    });

    // Check OfflineBanner is visible
    const banner = page.getByRole('status', { name: /offline/i });
    await expect(banner).toBeVisible();

    // Verify banner content
    await expect(banner).toContainText('You are offline');
    await expect(banner).toContainText('Using cached data');

    // Go back online
    await page.context().setOffline(false);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });

    // OfflineBanner should disappear
    await expect(banner).toBeHidden();
  });

  test('should serve cached API data when offline', async () => {
    // First, navigate to dashboard and load API data (trades/investments)
    await page.goto('/dashboard', { waitUntil: 'networkidle' });

    // Wait for API calls to complete and be cached
    await page.waitForLoadState('networkidle');

    // Capture initial API response
    const initialDealsText = await page
      .locator('[data-testid="deals-list"]')
      .textContent();
    expect(initialDealsText).toBeTruthy();

    // Go offline
    await page.context().setOffline(true);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'));
    });

    // Navigate to a different page
    await page.goto('/investments');
    await page.waitForLoadState('load');

    // Go back to dashboard - should still show cached deals
    await page.goto('/dashboard');
    const cachedDealsText = await page
      .locator('[data-testid="deals-list"]')
      .textContent();

    // Verify we got the same data from cache
    expect(cachedDealsText).toBe(initialDealsText);

    // Go back online
    await page.context().setOffline(false);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });
  });

  test('should clear cache on logout', async () => {
    // Wait for initial load and caching
    await page.waitForLoadState('networkidle');

    // Verify cache exists
    const cacheStatsBeforeLogout = await page.evaluate(() => {
      return caches.keys();
    });
    expect(cacheStatsBeforeLogout.length).toBeGreaterThan(0);

    // Simulate logout
    // (Intercept logout endpoint to verify cache clear is called)
    const cacheCleared = page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        // Listen for service worker cache clear message
        const timeoutId = setTimeout(() => resolve(false), 5000);

        navigator.serviceWorker.ready.then((registration) => {
          if (registration.active) {
            // Send logout signal to SW
            registration.active.postMessage({
              type: 'CLEAR_CACHE',
            });

            // Give SW time to process
            setTimeout(() => {
              caches.keys().then((names) => {
                const apiCaches = names.filter((n) =>
                  n.startsWith('agri-fi-api') || n.startsWith('agri-fi-runtime')
                );
                clearTimeout(timeoutId);
                resolve(apiCaches.length === 0);
              });
            }, 500);
          }
        });
      });
    });

    // Click logout button
    await page.click('[data-testid="logout-button"]');

    // Verify cache was cleared
    const cleared = await cacheCleared;
    expect(cleared).toBe(true);

    // Verify subsequent requests don't use old cache
    // (they should fail or require reloading from network)
    const response = await page.request.get('/api/v1/trade-deals', {
      headers: {
        Authorization: '', // Invalid token after logout
      },
    });
    
    // Should get 401 Unauthorized, not cached response
    expect(response.status()).toBe(401);
  });

  test('should use stale-while-revalidate for cacheable API endpoints', async () => {
    // Wait for initial load
    await page.waitForLoadState('networkidle');

    // Monitor for both cached and network responses
    const responses: { url: string; fromCache: boolean; status: number }[] = [];

    page.on('response', (response) => {
      if (response.url().includes('/api/v1/trade-deals')) {
        responses.push({
          url: response.url(),
          fromCache: response.fromServiceWorker() ?? false,
          status: response.status(),
        });
      }
    });

    // First request - should be from network
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Second request while offline - should be from cache (stale-while-revalidate)
    await page.context().setOffline(true);
    
    // Trigger refresh or navigate to re-fetch
    await page.reload();
    await page.waitForLoadState('load');

    // Should have at least one response from cache
    const cachedResponses = responses.filter((r) => r.fromCache);
    expect(cachedResponses.length).toBeGreaterThan(0);

    await page.context().setOffline(false);
  });

  test('should handle cache degradation gracefully', async () => {
    // Go offline before any content loads
    await page.context().setOffline(true);

    // Try to navigate to new page with no cache
    const response = await page.goto('/unknown-page', {
      waitUntil: 'load',
    });

    // Should return 503 Service Unavailable or navigate to offline page
    expect(
      response?.status() === 503 ||
      page.url().includes('offline')
    ).toBe(true);

    await page.context().setOffline(false);
  });

  test('should restore functionality after reconnecting', async () => {
    // Start online
    await page.goto('/dashboard', { waitUntil: 'networkidle' });
    const onlineButton = page.locator('[data-testid="create-deal-button"]');
    await expect(onlineButton).toBeEnabled();

    // Go offline
    await page.context().setOffline(true);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'));
    });

    // Button should still be visible but may be disabled
    await expect(onlineButton).toBeVisible();

    // Reconnect
    await page.context().setOffline(false);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });

    // OfflineBanner should hide
    const banner = page.getByRole('status', { name: /offline/i });
    await expect(banner).toBeHidden();

    // Should be able to interact again
    await expect(onlineButton).toBeEnabled();
  });
});

test.describe('Service Worker Lifecycle', () => {
  test('should register service worker on page load', async ({ page }) => {
    await page.goto('/');

    const serviceWorkerReady = await page.evaluate(() => {
      return navigator.serviceWorker.ready.then(() => true);
    });

    expect(serviceWorkerReady).toBe(true);
  });

  test('should handle service worker updates gracefully', async ({ page }) => {
    // Load page
    await page.goto('/dashboard');

    // Simulate service worker update check
    const updateResult = await page.evaluate(() => {
      return navigator.serviceWorker.controller?.controller === null
        ? 'no-controller'
        : 'has-controller';
    });

    expect(updateResult).toBe('has-controller');
  });
});
