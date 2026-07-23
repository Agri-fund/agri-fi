import { test, expect } from '@playwright/test';

test.describe('Farmer Dashboard', () => {

    test.beforeEach(async ({ page }) => {
        // Go to login page first
        await page.goto('/login');

        await page.fill('[data-testid="email"]', 'farmer@test.com');
        await page.fill('[data-testid="password"]', 'password123');
        await page.click('button[type="submit"]');

        // Wait until we land on farmer dashboard
        await page.waitForURL('/dashboard/farmer*');
    });

    test('should load farmer dashboard successfully', async ({ page }) => {
        await expect(page.getByRole('heading', { name: /dashboard|welcome/i })).toBeVisible();
        await expect(page.getByText('My Loans')).toBeVisible();
        await expect(page.getByText('Total Balance')).toBeVisible();
    });

    test('should display active loans section', async ({ page }) => {
        await expect(page.getByTestId('active-loans')).toBeVisible();
    });

});