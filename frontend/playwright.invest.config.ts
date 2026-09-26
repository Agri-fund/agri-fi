import { defineConfig, devices } from '@playwright/test';

/**
 * Investment-flow E2E (#977 / #976).
 *
 * Starts a mock backend on :3001 (serves deal SSR) and the Next dev server
 * with the fixture deal pre-registered as a static marketplace id. All wallet
 * and browser-side API traffic is mocked inside the spec.
 *
 * Note: a real backend already listening on :3001 will make this fail to
 * start — stop it first.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /investment-flow\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 90 * 1000,
  expect: { timeout: 15 * 1000 },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node tests/e2e/mocks/mock-backend.mjs',
      url: 'http://localhost:3001/__health',
      reuseExistingServer: false,
      timeout: 15 * 1000,
    },
    {
      command: 'npm run dev',
      port: 3000,
      reuseExistingServer: !process.env.CI,
      timeout: 180 * 1000,
      env: {
        STATIC_MARKETPLACE_IDS: 'deal-e2e-1',
        BACKEND_URL: 'http://localhost:3001',
        NEXT_PUBLIC_STELLAR_NETWORK: 'testnet',
      },
    },
  ],
});
