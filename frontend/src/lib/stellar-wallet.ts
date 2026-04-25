/**
 * stellar-wallet.ts
 *
 * Unified helper for connecting to Stellar wallets (Freighter and Albedo).
 * All private-key operations happen inside the wallet extension / pop-up —
 * the app never sees or stores any secret key.
 *
 * Issue #83 — Integrate Freighter & Albedo for Client-Side Signing
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type WalletProvider = 'freighter' | 'albedo';

export interface WalletConnectResult {
  publicKey: string;
  provider: WalletProvider;
}

export interface WalletSignResult {
  signedXdr: string;
  provider: WalletProvider;
}

// ── Freighter helpers ─────────────────────────────────────────────────────────

async function freighterIsAvailable(): Promise<boolean> {
  try {
    const { isConnected } = await import('@stellar/freighter-api');
    const result = await isConnected();
    // freighter-api v2 returns { isConnected: boolean } or just boolean
    return typeof result === 'object' ? (result as any).isConnected : result;
  } catch {
    return false;
  }
}

async function connectFreighter(): Promise<WalletConnectResult> {
  const { getPublicKey } = await import('@stellar/freighter-api');
  const result = await getPublicKey();
  // v2 API returns { publicKey } or plain string
  const publicKey = typeof result === 'object' ? (result as any).publicKey : result;
  if (!publicKey) throw new Error('Freighter did not return a public key.');
  return { publicKey, provider: 'freighter' };
}

async function signWithFreighter(
  xdr: string,
  networkPassphrase: string,
): Promise<WalletSignResult> {
  const { signTransaction } = await import('@stellar/freighter-api');
  const result = await signTransaction(xdr, { networkPassphrase });
  // v2 returns { signedTxXdr } or plain string
  const signedXdr =
    typeof result === 'object' ? (result as any).signedTxXdr : result;
  if (!signedXdr) throw new Error('Freighter did not return a signed XDR.');
  return { signedXdr, provider: 'freighter' };
}

// ── Albedo helpers ────────────────────────────────────────────────────────────

/** CDN URL for the Albedo intent library. Loaded on first use. */
const ALBEDO_CDN = 'https://cdn.albedo.link/albedo-link.js';

/** Lazily loads the Albedo CDN script into the page and returns the global. */
async function loadAlbedo(): Promise<any> {
  if (typeof window === 'undefined') {
    throw new Error('Albedo requires a browser environment.');
  }
  // Already loaded?
  if ((window as any).albedo) return (window as any).albedo;

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = ALBEDO_CDN;
    script.async = true;
    script.onload = () => {
      const albedo = (window as any).albedo;
      if (!albedo) reject(new Error('Albedo failed to load from CDN.'));
      else resolve(albedo);
    };
    script.onerror = () => reject(new Error('Failed to load Albedo CDN script.'));
    document.head.appendChild(script);
  });
}

/** Returns true when Albedo CDN can be loaded (always true in a browser). */
function albedoIsAvailable(): boolean {
  return typeof window !== 'undefined';
}

async function connectAlbedo(): Promise<WalletConnectResult> {
  const albedo = await loadAlbedo();
  const result = await albedo.publicKey({});
  if (!result?.pubkey) throw new Error('Albedo did not return a public key.');
  return { publicKey: result.pubkey, provider: 'albedo' };
}

async function signWithAlbedo(
  xdr: string,
  networkPassphrase: string,
): Promise<WalletSignResult> {
  const albedo = await loadAlbedo();
  const result = await albedo.tx({ xdr, network: networkPassphrase });
  if (!result?.signed_envelope_xdr)
    throw new Error('Albedo did not return a signed XDR.');
  return { signedXdr: result.signed_envelope_xdr, provider: 'albedo' };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detects which Stellar wallets are available in the current browser session.
 * Returns a list of available provider identifiers.
 */
export async function detectAvailableWallets(): Promise<WalletProvider[]> {
  const available: WalletProvider[] = [];
  if (await freighterIsAvailable()) available.push('freighter');
  if (albedoIsAvailable()) available.push('albedo');
  return available;
}

/**
 * Connects to the requested Stellar wallet and returns the user's public key.
 * Throws if the user denies access or the wallet is unavailable.
 */
export async function connectWallet(
  provider: WalletProvider,
): Promise<WalletConnectResult> {
  switch (provider) {
    case 'freighter':
      return connectFreighter();
    case 'albedo':
      return connectAlbedo();
    default:
      throw new Error(`Unknown wallet provider: ${provider}`);
  }
}

/**
 * Signs an unsigned XDR transaction with the selected wallet.
 * The private key never leaves the wallet.
 *
 * @param xdr               Unsigned transaction in base64-encoded XDR format
 * @param provider          Wallet to use for signing
 * @param networkPassphrase Stellar network passphrase (testnet or mainnet)
 */
export async function signTransactionWithWallet(
  xdr: string,
  provider: WalletProvider,
  networkPassphrase: string,
): Promise<WalletSignResult> {
  switch (provider) {
    case 'freighter':
      return signWithFreighter(xdr, networkPassphrase);
    case 'albedo':
      return signWithAlbedo(xdr, networkPassphrase);
    default:
      throw new Error(`Unknown wallet provider: ${provider}`);
  }
}
