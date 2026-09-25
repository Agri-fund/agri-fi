import { test, expect } from '@playwright/test';

test.describe('Content Security Policy (CSP)', () => {
  test('should return CSP header on page responses', async ({ page }) => {
    const response = await page.goto('/');
    expect(response).not.toBeNull();

    const headers = response!.headers();
    const cspHeader =
      headers['content-security-policy-report-only'] ||
      headers['content-security-policy'];

    expect(cspHeader).toBeDefined();
    expect(cspHeader).toContain("default-src 'self'");
    expect(cspHeader).toContain("style-src 'self' 'unsafe-inline'");
    expect(cspHeader).toContain("img-src 'self'");
    expect(cspHeader).toContain("connect-src 'self'");
    expect(cspHeader).toContain("frame-ancestors 'none'");
    expect(cspHeader).toContain("form-action 'self'");
  });

  test('should generate x-nonce header per request', async ({ page }) => {
    const response = await page.goto('/');
    expect(response).not.toBeNull();

    const headers = response!.headers();
    const nonce = headers['x-nonce'];
    expect(nonce).toBeDefined();
    expect(nonce!.length).toBeGreaterThan(10);
  });
});
