import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.VISUAL_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/visual-regression.spec.ts',
  outputDir: './visual-test-results',
  snapshotPathTemplate: '{testDir}/visual-baselines/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'visual-playwright-report', open: 'never' }],
    ['json', { outputFile: 'visual-test-results/results.json' }],
  ],
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.01,
    },
  },
  use: {
    baseURL,
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-visual',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  timeout: 60_000,
});
