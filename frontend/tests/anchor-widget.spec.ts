import { test, expect, type Page, type Route } from '@playwright/test';

const ANCHORS = [
  {
    id: 'anchor-1',
    name: 'Test Anchor',
    interactiveUrl: 'https://anchor.example.com/sep24',
    assets: ['USDC'],
  },
];

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

async function mockAnchors(page: Page) {
  await page.route('**/v1/stellar/anchors', (route) => json(route, { anchors: ANCHORS }));
}

async function mockTransaction(page: Page, statuses: string[]) {
  let call = 0;
  await page.route('**/v1/stellar/transactions/*', (route) => {
    const status = statuses[Math.min(call, statuses.length - 1)];
    call += 1;
    return json(route, { id: 'tx-1', status });
  });
}

test.describe('AnchorWidget', () => {
  test('happy path: lists anchors, launches interactive flow, and completes deposit', async ({ page }) => {
    await mockAnchors(page);
    await mockTransaction(page, ['pending_user_transfer_start', 'completed']);

    await page.goto('/anchor');

    await expect(page.getByText('Test Anchor')).toBeVisible();

    await page.getByRole('button', { name: /deposit/i }).click();

    const iframe = page.locator('iframe[title*="anchor" i]');
    await expect(iframe).toBeVisible();
    await expect(iframe).toHaveAttribute('src', /anchor\.example\.com/);

    await expect(page.getByText(/completed/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /proceed to invest/i })).toBeVisible();
  });

  test('withdrawal flow launches interactive iframe', async ({ page }) => {
    await mockAnchors(page);
    await mockTransaction(page, ['pending_user_transfer_start']);

    await page.goto('/anchor');
    await page.getByRole('button', { name: /withdraw/i }).click();

    await expect(page.locator('iframe[title*="anchor" i]')).toBeVisible();
  });

  test('shows inline prompt when status is needs_more_info', async ({ page }) => {
    await mockAnchors(page);
    await mockTransaction(page, ['needs_more_info']);

    await page.goto('/anchor');
    await page.getByRole('button', { name: /deposit/i }).click();

    await expect(page.getByText(/more information/i)).toBeVisible({ timeout: 10_000 });
  });

  test('error state: anchors fail to load', async ({ page }) => {
    await page.route('**/v1/stellar/anchors', (route) =>
      json(route, { error: 'unavailable' }, 500),
    );

    await page.goto('/anchor');

    await expect(page.getByText(/failed to load anchors/i)).toBeVisible();
  });

  test('error state: transaction polling fails', async ({ page }) => {
    await mockAnchors(page);
    await page.route('**/v1/stellar/transactions/*', (route) =>
      json(route, { error: 'not found' }, 404),
    );

    await page.goto('/anchor');
    await page.getByRole('button', { name: /deposit/i }).click();

    await expect(page.getByText(/unable to fetch transaction status/i)).toBeVisible({
      timeout: 10_000,
    });
  });
});
