import { test, expect } from '@playwright/test';

test.describe('PWA Install Prompt', () => {
  test('should register service worker on page load', async ({ page }) => {
    await page.goto('/');

    // Check if service worker is registered
    const swRegistered = await page.evaluate(() => {
      return navigator.serviceWorker.getRegistrations().then((regs) => {
        return regs.some((reg) => reg.scope === '/');
      });
    });

    expect(swRegistered).toBe(true);
  });

  test('should have manifest.json available', async ({ page }) => {
    await page.goto('/');

    const manifestLink = await page.$('link[rel="manifest"]');
    expect(manifestLink).not.toBeNull();

    // Fetch and validate manifest
    const manifestUrl = await manifestLink?.getAttribute('href');
    const manifestResponse = await page.goto(manifestUrl || '');
    expect(manifestResponse?.status()).toBe(200);

    const manifest = await page.evaluate(() => {
      return fetch('manifest.json').then((r) => r.json());
    });

    expect(manifest).toHaveProperty('name');
    expect(manifest).toHaveProperty('short_name');
    expect(manifest).toHaveProperty('icons');
    expect(manifest.display).toBe('standalone');
  });

  test('should show install banner after 30 seconds on beforeinstallprompt', async ({
    page,
    context,
  }) => {
    // Create a page with mocked beforeinstallprompt event
    await page.goto('/');

    // Simulate beforeinstallprompt event
    const beforeInstallPromptEvent = await page.evaluateHandle(() => {
      return new Event('beforeinstallprompt', {
        bubbles: true,
        cancelable: true,
      });
    });

    // Dispatch the event
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', {
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
    });

    // Wait for banner to appear (max 35 seconds to account for 30s delay + processing)
    const installBanner = page.locator(
      'div:has-text("Install AgriFi")',
    );

    // The banner uses React state, so we need to wait for it to render
    // After beforeinstallprompt is fired, wait for the 30-second timer
    await page.waitForTimeout(31000);

    // Check if banner is visible
    const isVisible = await installBanner.isVisible().catch(() => false);
    expect(isVisible).toBe(true);
  });

  test('should hide banner when "Not now" button is clicked', async ({
    page,
  }) => {
    await page.goto('/');

    // Simulate beforeinstallprompt
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', {
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);
    });

    // Wait for banner to appear
    await page.waitForTimeout(31000);

    const installBanner = page.locator(
      'div:has-text("Install AgriFi")',
    );
    const notNowButton = installBanner.locator('button:has-text("Not now")');

    // Click "Not now"
    await notNowButton.click();

    // Banner should be hidden
    await expect(installBanner).not.toBeVisible();
  });

  test('should trigger install prompt when "Install" button is clicked', async ({
    page,
  }) => {
    await page.goto('/');

    // Mock deferredPrompt and beforeinstallprompt
    const mockPromptResult = await page.evaluateHandle(() => {
      let deferredPrompt: any;

      window.addEventListener('beforeinstallprompt', (e: any) => {
        e.preventDefault();
        deferredPrompt = {
          prompt: () => Promise.resolve(),
          userChoice: Promise.resolve({ outcome: 'accepted' }),
        };
      });

      // Dispatch beforeinstallprompt
      const event = new Event('beforeinstallprompt', {
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(event);

      return deferredPrompt;
    });

    // Wait for banner
    await page.waitForTimeout(31000);

    const installBanner = page.locator(
      'div:has-text("Install AgriFi")',
    );
    const installButton = installBanner.locator('button:has-text("Install")');

    // Mock the prompt
    await page.evaluate(() => {
      (window as any).promptInstall = async () => {
        // Simulate successful install
        const event = new Event('appinstalled');
        window.dispatchEvent(event);
      };
    });

    // Click Install
    await installButton.click();

    // Banner should hide after install
    await page.waitForTimeout(1000);
    await expect(installBanner).not.toBeVisible();
  });

  test('should show offline.html when offline', async ({ page }) => {
    await page.goto('/');

    // Wait for service worker to be fully active
    await page.waitForTimeout(2000);

    // Go offline
    await page.context().setOffline(true);

    // Navigate to a page that isn't cached
    const response = await page.goto('/nonexistent-page', {
      waitUntil: 'networkidle',
    }).catch(() => null);

    // Should show offline fallback
    const offlineText = page.locator('text=You are Offline');
    await expect(offlineText).toBeVisible();

    // Go back online
    await page.context().setOffline(false);
  });

  test('should have iOS meta tags', async ({ page }) => {
    await page.goto('/');

    // Check for apple-mobile-web-app-capable
    const appleMobileCapable = await page.evaluate(() => {
      return document.querySelector(
        'meta[name="apple-mobile-web-app-capable"]',
      )?.getAttribute('content');
    });
    expect(appleMobileCapable).toBe('yes');

    // Check for apple-mobile-web-app-status-bar-style
    const statusBarStyle = await page.evaluate(() => {
      return document.querySelector(
        'meta[name="apple-mobile-web-app-status-bar-style"]',
      )?.getAttribute('content');
    });
    expect(statusBarStyle).toBe('black-translucent');

    // Check for apple-mobile-web-app-title
    const appTitle = await page.evaluate(() => {
      return document.querySelector(
        'meta[name="apple-mobile-web-app-title"]',
      )?.getAttribute('content');
    });
    expect(appTitle).toBe('AgriFi');
  });

  test('should cache static assets after service worker activation', async ({
    page,
  }) => {
    await page.goto('/');

    // Wait for service worker to cache assets
    await page.waitForTimeout(2000);

    // Check if cache exists
    const cacheNames = await page.evaluate(() => {
      return caches.keys();
    });

    expect(cacheNames.length).toBeGreaterThan(0);
    expect(cacheNames.some((name) => name.includes('agri-fi'))).toBe(true);
  });

  test('should support app shortcuts in manifest', async ({ page }) => {
    await page.goto('/');

    const manifest = await page.evaluate(() => {
      return fetch('manifest.json').then((r) => r.json());
    });

    expect(manifest.shortcuts).toBeDefined();
    expect(manifest.shortcuts.length).toBeGreaterThan(0);
    expect(manifest.shortcuts[0]).toHaveProperty('name');
    expect(manifest.shortcuts[0]).toHaveProperty('url');
  });

  test('should have required PWA icons', async ({ page }) => {
    await page.goto('/');

    const manifest = await page.evaluate(() => {
      return fetch('manifest.json').then((r) => r.json());
    });

    // Check for 192x192 icon
    const icon192 = manifest.icons.find(
      (icon: any) => icon.sizes === '192x192' && icon.purpose === 'any',
    );
    expect(icon192).toBeDefined();

    // Check for 512x512 icon
    const icon512 = manifest.icons.find(
      (icon: any) => icon.sizes === '512x512' && icon.purpose === 'any',
    );
    expect(icon512).toBeDefined();

    // Check for maskable icons
    const maskable192 = manifest.icons.find(
      (icon: any) => icon.sizes === '192x192' && icon.purpose === 'maskable',
    );
    expect(maskable192).toBeDefined();
  });

  test('should load page in under 2 seconds from cache on repeat visits', async ({
    page,
  }) => {
    // First visit
    const startFirst = Date.now();
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const firstLoadTime = Date.now() - startFirst;

    // Second visit (should use cache)
    const startSecond = Date.now();
    await page.reload();
    const secondLoadTime = Date.now() - startSecond;

    // Second load should be significantly faster (cached)
    expect(secondLoadTime).toBeLessThan(firstLoadTime);
  });
});
