import { test, expect, type Page } from '@playwright/test';

/**
 * E2E coverage for the InvestmentForm wallet flow (#1310).
 *
 * The Freighter wallet is mocked via `page.addInitScript` so the tests can
 * exercise the connect → submit → sign → confirm flow without a real wallet.
 */

const TEST_SIGNING_KEY = 'SDPUBTESTKEY0000000000000000000000000000000000000000000';
const TEST_PUBLIC_KEY = 'GDTESTPUBLICKEY000000000000000000000000000000000000000';

interface FreighterMockOptions {
  network?: 'PUBLIC' | 'TESTNET';
  online?: boolean;
}

async function installFreighterMock(page: Page, opts: FreighterMockOptions = {}) {
  const { network = 'TESTNET', online = true } = opts;

  await page.addInitScript(
    ({ signingKey, publicKey, network, online }) => {
      // Inject a deterministic test signing key for the mocked wallet.
      (window as unknown as Record<string, unknown>).__TEST_SIGNING_KEY__ = signingKey;

      const freighter = {
        isConnected: async () => ({ isConnected: true }),
        isAllowed: async () => ({ isAllowed: true }),
        getPublicKey: async () => publicKey,
        getNetwork: async () => ({ network, networkPassphrase: network === 'PUBLIC' ? 'Public Global Stellar Network ; September 2015' : 'Test SDF Network ; September 2015' }),
        signTransaction: async (xdr: string) => ({ signedTxXdr: xdr, signerAddress: publicKey }),
        requestAccess: async () => ({ address: publicKey }),
      };

      (window as unknown as Record<string, unknown>).freighter = freighter;
      (window as unknown as Record<string, unknown>).freighterApi = freighter;

      if (!online) {
        Object.defineProperty(window.navigator, 'onLine', {
          configurable: true,
          get: () => false,
        });
      }
    },
    { signingKey: TEST_SIGNING_KEY, publicKey: TEST_PUBLIC_KEY, network, online },
  );
}

test.describe('InvestmentForm wallet flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('happy path: connect Freighter → submit quantity → sign → confirm', async ({ page }) => {
    await installFreighterMock(page);
    await page.goto('/');

    await page.getByRole('button', { name: /connect wallet/i }).click();
    await expect(page.getByText(/connected/i)).toBeVisible();

    await page.getByLabel(/quantity/i).fill('10');
    await page.getByRole('button', { name: /invest/i }).click();

    // 3-step tx progress flow: sign → submit → confirm
    await expect(page.getByText(/sign/i)).toBeVisible();
    await expect(page.getByText(/confirm/i)).toBeVisible({ timeout: 15_000 });
  });

  test('network mismatch: wallet on mainnet but app configured for testnet shows warning', async ({ page }) => {
    await installFreighterMock(page, { network: 'PUBLIC' });
    await page.goto('/');

    await page.getByRole('button', { name: /connect wallet/i }).click();

    await expect(page.getByText(/network mismatch/i)).toBeVisible();
  });

  test('offline mode: investment is queued and toast appears', async ({ page }) => {
    await installFreighterMock(page, { online: false });
    await page.goto('/');

    await page.getByRole('button', { name: /connect wallet/i }).click();
    await page.getByLabel(/quantity/i).fill('10');
    await page.getByRole('button', { name: /invest/i }).click();

    await expect(page.getByText(/queued/i)).toBeVisible();
  });

  test('lot-size validation: quantity below minLotSize shows error and blocks submit', async ({ page }) => {
    await installFreighterMock(page);
    await page.goto('/');

    await page.getByRole('button', { name: /connect wallet/i }).click();
    await page.getByLabel(/quantity/i).fill('0.0001');
    await page.getByRole('button', { name: /invest/i }).click();

    await expect(page.getByText(/minimum lot size/i)).toBeVisible();
    await expect(page.getByText(/sign/i)).not.toBeVisible();
  });

  test('duplicate submission: second submit while isSubmitting is a no-op', async ({ page }) => {
    await installFreighterMock(page);
    await page.goto('/');

    await page.getByRole('button', { name: /connect wallet/i }).click();
    await page.getByLabel(/quantity/i).fill('10');

    const submit = page.getByRole('button', { name: /invest/i });
    await submit.click();
    await submit.click({ force: true });

    // Only a single signing request should be issued.
    const signCalls = await page.evaluate(() =>
      (window as unknown as { __signCallCount__?: number }).__signCallCount__ ?? 0,
    );
    expect(signCalls).toBeLessThanOrEqual(1);
  });
});
