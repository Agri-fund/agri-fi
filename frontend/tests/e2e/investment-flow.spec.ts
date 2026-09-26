/**
 * Investment journey E2E — #977 (flow) and #976 (keyboard + axe).
 *
 * deal → invest modal → wallet connect → sign → submit → receipt
 *
 * The journey starts on the deal page (the deal is "selected" by deep link):
 * the marketplace list page currently crashes on main (its filter state was
 * lost in a merge), so it can't be used as the entry point yet.
 *
 * Everything outside the Next.js app is mocked:
 *  - Wallets: Freighter is emulated at the postMessage layer and Albedo via its
 *    global (see ./mocks/wallets.ts), so the real wallet code paths run.
 *  - Browser → backend calls (http://localhost:3001) and browser → Next API
 *    proxy calls (/api/**) are fulfilled with `page.route`, so the proxy never
 *    forwards anything to a real backend.
 *  - SSR of the deal page hits ./mocks/mock-backend.mjs (started by
 *    playwright.invest.config.ts) because server fetches can't be routed.
 *
 * Run: pnpm test:e2e:invest
 */
import { test, expect, type Page, type Request } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fixtures from './mocks/fixtures.json';
import { getWalletCalls, installAlbedoMock, installFreighterMock } from './mocks/wallets';
import { tokenKey } from '../../src/lib/auth-token';

const AUTH_TOKEN = 'e2e-jwt-token';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const { deal, investor, wallet, investment } = fixtures;

interface ApiLog {
  create: Request[];
  submit: Request[];
}

async function seedAuthenticatedInvestor(page: Page) {
  await page.addInitScript(
    ({ key, token, user }) => {
      localStorage.setItem(key, token);
      localStorage.setItem('auth_user', JSON.stringify(user));
    },
    { key: tokenKey, token: AUTH_TOKEN, user: investor },
  );
}

async function mockBackend(page: Page): Promise<ApiLog> {
  const log: ApiLog = { create: [], submit: [] };

  // Direct browser → backend calls made by lib/api.ts.
  await page.route('http://localhost:3001/**', (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/v1/trade-deals') {
      return route.fulfill({ json: { data: [deal], total: 1, page: 1, limit: 12 } });
    }
    if (pathname === `/v1/trade-deals/${deal.id}`) {
      return route.fulfill({ json: deal });
    }
    return route.fulfill({ status: 404, json: { message: `Not mocked: ${pathname}` } });
  });

  // Next API proxy routes. Registered first = lowest priority: anything not
  // explicitly mocked below is answered here instead of reaching the backend.
  await page.route(
    (url) => url.origin === 'http://localhost:3000' && url.pathname.startsWith('/api/'),
    (route) => route.fulfill({ status: 404, json: { message: 'Not mocked' } }),
  );

  await page.route('**/api/auth/wallet', (route) => route.fulfill({ json: { ok: true } }));

  await page.route('**/api/investments', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    log.create.push(route.request());
    const body = route.request().postDataJSON();
    return route.fulfill({
      json: {
        investment: { id: investment.id, tokenAmount: body.tokenAmount, amountUsd: body.amountUsd },
        unsignedXdr: investment.unsignedXdr,
      },
    });
  });

  // The form submits the signed XDR via /fund (the backend route); submit-tx
  // is mocked identically so the spec keeps passing if the client switches.
  for (const path of ['fund', 'submit-tx']) {
    await page.route(`**/api/investments/${investment.id}/${path}`, (route) => {
      log.submit.push(route.request());
      return route.fulfill({
        json: {
          status: 'confirmed',
          investmentId: investment.id,
          stellarTxId: investment.stellarTxId,
        },
      });
    });
  }

  return log;
}

async function expectNoA11yViolations(page: Page, context: string) {
  // Modal panels fade/slide in; scanning mid-animation reports false
  // color-contrast failures because text is still partially transparent.
  // Infinite animations (spinners, pulses) are ignored.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
      .every((a) => a.playState !== 'running'),
  );
  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();

  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(summary, `axe violations in ${context}`).toEqual([]);
}

async function openInvestmentModal(page: Page) {
  await page.goto(`/en/marketplace/${deal.id}/`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/coffee/i);

  const fundButton = page.getByRole('button', { name: /fund this deal/i });
  await fundButton.click();

  const modal = page.getByRole('dialog', { name: /invest in coffee/i });
  await expect(modal).toBeVisible();
  return { modal, fundButton };
}

test.describe('Investment flow (mocked wallet + backend)', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthenticatedInvestor(page);
  });

  test('Freighter: connect → sign → submit → receipt, keyboard only inside the modal', async ({ page }) => {
    await installFreighterMock(page, { ...wallet, network: 'TESTNET' });
    const api = await mockBackend(page);

    const { modal, fundButton } = await openInvestmentModal(page);
    await expectNoA11yViolations(page, 'investment modal (disconnected)');

    // Initial focus lands on the connect action.
    const connectButton = modal.getByRole('button', { name: 'Connect wallet' });
    await expect(connectButton).toBeFocused();
    await page.keyboard.press('Enter');

    // Wallet picker opens on top of the investment modal and owns focus.
    const picker = page.getByTestId('wallet-selection-modal');
    await expect(picker).toBeVisible();
    await expectNoA11yViolations(page, 'wallet selection modal');

    await expect(page.getByTestId('wsm-close-btn')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('wsm-freighter-btn')).toBeFocused();
    await page.keyboard.press('Enter');

    // Connected: picker closes and focus returns to the amount field.
    await expect(picker).toBeHidden();
    const amount = modal.getByLabel('Number of Tokens');
    await expect(amount).toBeFocused();

    await amount.fill('3');
    await expect(modal.getByRole('button', { name: 'Invest $300.00' })).toBeVisible();
    await page.keyboard.press('Enter'); // submit the form from the field

    // Receipt screen reflects the confirmed status and receives focus.
    const successHeading = modal.getByRole('heading', { name: 'Investment Successful!' });
    await expect(successHeading).toBeVisible();
    await expect(successHeading).toBeFocused();
    await expect(page.getByTestId('investment-step-announcer')).toHaveText(
      /investment confirmed/i,
    );
    const receipt = modal.getByTestId('investment-receipt');
    await expect(receipt).toContainText(investment.stellarTxId);
    await expect(receipt).toContainText('Confirmed');
    await expectNoA11yViolations(page, 'investment receipt');

    // Backend contract: create → sign → submit with the signed XDR.
    expect(api.create).toHaveLength(1);
    expect(api.create[0].headers()['authorization']).toBe(`Bearer ${AUTH_TOKEN}`);
    expect(api.create[0].postDataJSON()).toMatchObject({
      tradeDealId: deal.id,
      tokenAmount: 3,
      amountUsd: 300,
    });
    expect(api.submit).toHaveLength(1);
    expect(api.submit[0].headers()['authorization']).toBe(`Bearer ${AUTH_TOKEN}`);
    expect(api.submit[0].postDataJSON()).toEqual({
      investorWalletAddress: wallet.publicKey,
      signedXdr: wallet.signedXdr,
    });

    const signCalls = (await getWalletCalls(page)).filter((c) => c.type === 'SUBMIT_TRANSACTION');
    expect(signCalls).toEqual([
      expect.objectContaining({
        transactionXdr: investment.unsignedXdr,
        networkPassphrase: TESTNET_PASSPHRASE,
      }),
    ]);

    // Stellar receipt modal: open via keyboard, Escape closes only it.
    await page.keyboard.press('Tab');
    await expect(modal.getByRole('button', { name: 'View receipt' })).toBeFocused();
    await page.keyboard.press('Enter');
    const txReceipt = page.getByRole('dialog', { name: 'Stellar transaction receipt' });
    await expect(txReceipt).toBeVisible();
    await expect(txReceipt).toContainText('Confirmed on Stellar');
    await expectNoA11yViolations(page, 'transaction receipt modal');

    await page.keyboard.press('Escape');
    await expect(txReceipt).toBeHidden();
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('button', { name: 'View receipt' })).toBeFocused();

    // Escape closes the investment modal and restores focus to the trigger.
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(fundButton).toBeFocused();
  });

  test('Albedo: connect → sign → submit renders the confirmed receipt', async ({ page }) => {
    await installAlbedoMock(page, wallet);
    const api = await mockBackend(page);

    const { modal } = await openInvestmentModal(page);
    await modal.getByRole('button', { name: 'Connect wallet' }).click();
    await page.getByTestId('wsm-albedo-btn').click();

    const amount = modal.getByLabel('Number of Tokens');
    await expect(amount).toBeVisible();
    await amount.fill('2');
    await modal.getByRole('button', { name: 'Invest $200.00' }).click();

    await expect(modal.getByRole('heading', { name: 'Investment Successful!' })).toBeVisible();
    await expect(modal.getByTestId('investment-receipt')).toContainText(investment.stellarTxId);

    expect(api.submit).toHaveLength(1);
    expect(api.submit[0].postDataJSON()).toEqual({
      investorWalletAddress: wallet.publicKey,
      signedXdr: wallet.signedXdr,
    });
    const calls = await getWalletCalls(page);
    expect(calls).toContainEqual(
      expect.objectContaining({ type: 'albedo.tx', transactionXdr: investment.unsignedXdr }),
    );
  });
});
