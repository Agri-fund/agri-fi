/**
 * soroban.ts
 *
 * Client-side helpers for building and signing Soroban contract invocation
 * transactions via Freighter wallet. The backend handles simulation and
 * submission; the frontend only needs to sign the prepared XDR.
 *
 * For invest() calls the flow is:
 *   1. Backend builds unsigned XDR (invest op on FarmCampaign contract)
 *   2. Frontend signs with Freighter
 *   3. Frontend submits signed XDR back to backend
 */

import { signTransaction } from '@stellar/freighter-api';

const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'
    ? 'Public Global Stellar Network ; September 2015'
    : 'Test SDF Network ; September 2015';

/**
 * Signs a Soroban transaction XDR using Freighter.
 * Returns the signed XDR string.
 */
export async function signSorobanTransaction(xdr: string): Promise<string> {
  const result = await signTransaction(xdr, {
    networkPassphrase: NETWORK_PASSPHRASE,
  });

  // Freighter v2+ returns { signedTxXdr }; older returns plain string
  const signed =
    typeof result === 'object' && 'signedTxXdr' in result
      ? (result as any).signedTxXdr
      : result;

  if (!signed) throw new Error('Freighter did not return a signed XDR.');
  return signed;
}

/**
 * Fetches the on-chain campaign state from the backend Soroban proxy.
 */
export async function getCampaignState(
  contractId: string,
  authToken: string,
): Promise<CampaignState | null> {
  const res = await fetch(`/api/soroban/campaign/${contractId}/state`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Fetches an investor's ownership percentage (in basis points) from the contract.
 */
export async function getInvestorOwnership(
  contractId: string,
  investorAddress: string,
  authToken: string,
): Promise<{ ownershipBps: number; ownershipPct: string }> {
  const res = await fetch(
    `/api/soroban/campaign/${contractId}/investor/${investorAddress}/ownership`,
    { headers: { Authorization: `Bearer ${authToken}` } },
  );
  if (!res.ok) throw new Error('Failed to fetch ownership');
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type CampaignStatus =
  | 'Open'
  | 'Funded'
  | 'Active'
  | 'Delivered'
  | 'Completed'
  | 'Failed'
  | 'Paused'
  | 'Disputed';

export interface CampaignState {
  status: CampaignStatus;
  total_raised: string;
  milestones_released: number;
}
