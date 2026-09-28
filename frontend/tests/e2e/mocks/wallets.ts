import type { Page } from '@playwright/test';

export interface WalletMockOptions {
  publicKey: string;
  signedXdr: string;
  /** Freighter network name: 'TESTNET' | 'PUBLIC'. */
  network?: string;
}

export interface WalletMockCall {
  type: string;
  transactionXdr?: string;
  networkPassphrase?: string;
}

/**
 * Emulates the Freighter browser extension.
 *
 * `@stellar/freighter-api` v2 detects the extension via `window.freighter`
 * and talks to it with `window.postMessage` (FREIGHTER_EXTERNAL_MSG_REQUEST →
 * FREIGHTER_EXTERNAL_MSG_RESPONSE). Answering those messages lets the real
 * library code run unmodified, so `getPublicKey`, `requestAccess`,
 * `getNetwork` and `signTransaction` resolve deterministically in CI.
 *
 * Every request is recorded on `window.__walletMock.calls`.
 */
export async function installFreighterMock(page: Page, options: WalletMockOptions) {
  await page.addInitScript((opts) => {
    const w = window as any;
    w.__walletMock = w.__walletMock ?? { calls: [] };
    w.freighter = true;

    window.addEventListener('message', (event) => {
      const data = event.data;
      if (event.source !== window || data?.source !== 'FREIGHTER_EXTERNAL_MSG_REQUEST') return;

      w.__walletMock.calls.push({
        type: data.type,
        transactionXdr: data.transactionXdr,
        networkPassphrase: data.networkPassphrase,
      });

      let payload: Record<string, unknown>;
      switch (data.type) {
        case 'REQUEST_CONNECTION_STATUS':
          payload = { isConnected: true };
          break;
        case 'REQUEST_ALLOWED_STATUS':
        case 'SET_ALLOWED_STATUS':
          payload = { isAllowed: true };
          break;
        case 'REQUEST_PUBLIC_KEY':
        case 'REQUEST_ACCESS':
          payload = { publicKey: opts.publicKey };
          break;
        case 'REQUEST_NETWORK':
          payload = { network: opts.network ?? 'TESTNET' };
          break;
        case 'SUBMIT_TRANSACTION':
          payload = { signedTransaction: opts.signedXdr };
          break;
        default:
          payload = { error: `Unmocked Freighter request: ${data.type}` };
      }

      window.postMessage(
        {
          source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE',
          // freighter-api v2 matches responses on this (misspelled) key.
          messagedId: data.messageId,
          ...payload,
        },
        window.location.origin,
      );
    });
  }, options);
}

/**
 * Stubs the Albedo global so the CDN script is never loaded.
 * Calls are recorded on `window.__walletMock.calls` as `albedo.*`.
 */
export async function installAlbedoMock(page: Page, options: WalletMockOptions) {
  await page.addInitScript((opts) => {
    const w = window as any;
    w.__walletMock = w.__walletMock ?? { calls: [] };
    w.albedo = {
      publicKey: async () => {
        w.__walletMock.calls.push({ type: 'albedo.publicKey' });
        return { pubkey: opts.publicKey };
      },
      tx: async ({ xdr, network }: { xdr: string; network: string }) => {
        w.__walletMock.calls.push({
          type: 'albedo.tx',
          transactionXdr: xdr,
          networkPassphrase: network,
        });
        return { signed_envelope_xdr: opts.signedXdr };
      },
    };
  }, options);
}

export async function getWalletCalls(page: Page): Promise<WalletMockCall[]> {
  return page.evaluate(() => (window as any).__walletMock?.calls ?? []);
}
