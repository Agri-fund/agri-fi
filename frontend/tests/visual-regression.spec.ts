import { expect, test, type Page } from '@playwright/test';

async function dismissNextDevErrors(page: Page) {
  const hideErrors = page.getByRole('button', { name: 'Hide Errors' });
  if (await hideErrors.isVisible()) {
    await hideErrors.evaluate((button) => {
      const root = button.getRootNode();
      if (root instanceof ShadowRoot) root.host.remove();
    });
  }
}

test.describe('visual regression baselines', () => {
  test('transparency page renders seeded API data', async ({ page }) => {
    await page.route('**/api/trade-deals', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          id: 'visual-deal-1',
          commodity: 'Cocoa',
          totalValue: 10000,
          totalInvested: 2500,
          status: 'open',
          sorobanCampaignContractId: null,
          stellarAssetTxId: null,
          tokenSymbol: 'COCOA',
          createdAt: '2026-01-01T00:00:00.000Z',
        }]),
      });
    });
    await page.goto('/en/transparency');
    await expect(page.getByRole('heading', { name: 'Blockchain Transparency' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Cocoa' })).toBeVisible();
    await page.locator('main').screenshot({ path: 'visual-test-results/transparency-seeded.png' });
  });

  test('help center desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/help');
    await expect(page.getByRole('heading', { name: 'Help Center' })).toBeVisible();
    await dismissNextDevErrors(page);
    await expect(page.locator('main')).toHaveScreenshot('help-center-desktop.png');
  });

  test('help center mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/en/help');
    await expect(page.getByRole('heading', { name: 'Help Center' })).toBeVisible();
    await dismissNextDevErrors(page);
    await expect(page.locator('main')).toHaveScreenshot('help-center-mobile.png');
  });

  test('login page desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/login');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await dismissNextDevErrors(page);
    await expect(page.locator('div.min-h-screen.flex').first()).toHaveScreenshot(
      'login-desktop.png',
    );
  });

  test('login page mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/en/login');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await dismissNextDevErrors(page);
    await expect(page.locator('div.min-h-screen.flex').first()).toHaveScreenshot(
      'login-mobile.png',
    );
  });
});
