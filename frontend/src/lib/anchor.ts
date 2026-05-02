/**
 * anchor.ts
 *
 * Stellar Anchor integration helpers for fiat on/off-ramp operations.
 * Implements SEP-6 (deposit/withdraw) and SEP-24 (interactive) flows.
 *
 * Supported regions: Nigeria (NGN), Kenya (KES), Ghana (GHS), South Africa (ZAR)
 *
 * Usage:
 *   const { url } = await initiateDeposit({ asset: 'USDC', amount: '100', account: 'G...' });
 *   window.open(url); // Opens anchor's interactive deposit flow
 */

export type SupportedFiat = 'NGN' | 'KES' | 'GHS' | 'ZAR' | 'USD';

export interface AnchorConfig {
  homeDomain: string;
  assetCode: string;
  assetIssuer: string;
}

// Anchor configurations per region
// Replace with actual anchor home domains for production
export const ANCHOR_CONFIGS: Record<SupportedFiat, AnchorConfig> = {
  NGN: {
    homeDomain: process.env.NEXT_PUBLIC_ANCHOR_NGN_DOMAIN || 'anchor-ngn.example.com',
    assetCode: 'USDC',
    assetIssuer: process.env.NEXT_PUBLIC_USDC_ISSUER || '',
  },
  KES: {
    homeDomain: process.env.NEXT_PUBLIC_ANCHOR_KES_DOMAIN || 'anchor-kes.example.com',
    assetCode: 'USDC',
    assetIssuer: process.env.NEXT_PUBLIC_USDC_ISSUER || '',
  },
  GHS: {
    homeDomain: process.env.NEXT_PUBLIC_ANCHOR_GHS_DOMAIN || 'anchor-ghs.example.com',
    assetCode: 'USDC',
    assetIssuer: process.env.NEXT_PUBLIC_USDC_ISSUER || '',
  },
  ZAR: {
    homeDomain: process.env.NEXT_PUBLIC_ANCHOR_ZAR_DOMAIN || 'anchor-zar.example.com',
    assetCode: 'USDC',
    assetIssuer: process.env.NEXT_PUBLIC_USDC_ISSUER || '',
  },
  USD: {
    homeDomain: process.env.NEXT_PUBLIC_ANCHOR_USD_DOMAIN || 'anchor-usd.example.com',
    assetCode: 'USDC',
    assetIssuer: process.env.NEXT_PUBLIC_USDC_ISSUER || '',
  },
};

/**
 * Fetches the anchor's stellar.toml to discover SEP endpoints.
 */
async function fetchStellarToml(homeDomain: string): Promise<Record<string, string>> {
  const res = await fetch(`https://${homeDomain}/.well-known/stellar.toml`);
  if (!res.ok) throw new Error(`Failed to fetch stellar.toml from ${homeDomain}`);
  const text = await res.text();

  // Minimal TOML parser for key=value pairs
  const result: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^(\w+)\s*=\s*"([^"]+)"/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

export interface DepositParams {
  fiatCurrency: SupportedFiat;
  stellarAccount: string;
  amount?: string;
  jwtToken: string;
}

export interface AnchorInteractiveResult {
  url: string;
  id: string;
}

/**
 * Initiates a SEP-24 interactive deposit (fiat → USDC).
 * Returns the anchor's interactive URL to open in a popup/iframe.
 */
export async function initiateDeposit(
  params: DepositParams,
): Promise<AnchorInteractiveResult> {
  const config = ANCHOR_CONFIGS[params.fiatCurrency];
  const toml = await fetchStellarToml(config.homeDomain);

  const transferServerSep24 = toml['TRANSFER_SERVER_SEP0024'];
  if (!transferServerSep24) {
    throw new Error(`Anchor ${config.homeDomain} does not support SEP-24`);
  }

  const body = new URLSearchParams({
    asset_code: config.assetCode,
    account: params.stellarAccount,
    ...(params.amount && { amount: params.amount }),
  });

  const res = await fetch(`${transferServerSep24}/transactions/deposit/interactive`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Bearer ${params.jwtToken}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Deposit initiation failed');
  }

  return res.json();
}

export interface WithdrawParams {
  fiatCurrency: SupportedFiat;
  stellarAccount: string;
  amount?: string;
  jwtToken: string;
  dest?: string;       // Bank account / mobile money number
  destExtra?: string;  // Bank code / routing number
}

/**
 * Initiates a SEP-24 interactive withdrawal (USDC → fiat).
 */
export async function initiateWithdrawal(
  params: WithdrawParams,
): Promise<AnchorInteractiveResult> {
  const config = ANCHOR_CONFIGS[params.fiatCurrency];
  const toml = await fetchStellarToml(config.homeDomain);

  const transferServerSep24 = toml['TRANSFER_SERVER_SEP0024'];
  if (!transferServerSep24) {
    throw new Error(`Anchor ${config.homeDomain} does not support SEP-24`);
  }

  const body = new URLSearchParams({
    asset_code: config.assetCode,
    account: params.stellarAccount,
    ...(params.amount && { amount: params.amount }),
    ...(params.dest && { dest: params.dest }),
    ...(params.destExtra && { dest_extra: params.destExtra }),
  });

  const res = await fetch(`${transferServerSep24}/transactions/withdraw/interactive`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Bearer ${params.jwtToken}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Withdrawal initiation failed');
  }

  return res.json();
}

/**
 * Polls a SEP-24 transaction status until it reaches a terminal state.
 */
export async function pollTransactionStatus(
  homeDomain: string,
  transactionId: string,
  jwtToken: string,
  onUpdate?: (status: string) => void,
): Promise<string> {
  const toml = await fetchStellarToml(homeDomain);
  const server = toml['TRANSFER_SERVER_SEP0024'];
  if (!server) throw new Error('SEP-24 server not found');

  const TERMINAL = ['completed', 'error', 'refunded', 'expired'];
  let attempts = 0;

  while (attempts < 60) {
    const res = await fetch(`${server}/transaction?id=${transactionId}`, {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    const data = await res.json();
    const status: string = data?.transaction?.status ?? 'unknown';

    onUpdate?.(status);

    if (TERMINAL.includes(status)) return status;

    await new Promise((r) => setTimeout(r, 5000));
    attempts++;
  }

  return 'timeout';
}
