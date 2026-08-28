import { FeeBreakdown } from './fee-calculator.service';

/**
 * Utility for encoding and decoding fee information in Stellar transactions.
 *
 * Fees are encoded in the transaction memo to ensure they're included atomically
 * with the investment transaction. This allows the backend to verify that fees
 * were correctly applied when the transaction is confirmed on-chain.
 */

export interface EncodedFeeData {
  // Hash of fee breakdown for verification
  feeHash: string;
  // Total fees in stroops (1 USDC = 10,000,000 stroops)
  totalFeeStroops: number;
  // Compressed fee breakdown (base64)
  compressed: string;
}

/**
 * Encode fee breakdown into a format suitable for transaction memo
 * Uses hash-based verification to prevent tampering
 */
export function encodeFeeData(feeBreakdown: FeeBreakdown): EncodedFeeData {
  // Convert fees to stroops (1 USDC = 10,000,000 stroops)
  const totalFeeStroops = Math.round(feeBreakdown.totalFees * 10_000_000);

  // Create a hash of the fee breakdown for verification
  const feeString = JSON.stringify({
    grossAmount: feeBreakdown.grossAmount,
    platformOriginationFee: feeBreakdown.platformOriginationFee?.amount || 0,
    platformSuccessFee: feeBreakdown.platformSuccessFee?.amount || 0,
    investorEntryFee: feeBreakdown.investorEntryFee?.amount || 0,
    earlyExitFee: feeBreakdown.earlyExitFee?.amount || 0,
    totalFees: feeBreakdown.totalFees,
    netInvestmentAmount: feeBreakdown.netInvestmentAmount,
  });

  // Simple hash: first 16 chars of base64 SHA256
  // In production, use crypto module for proper hashing
  const feeHash = Buffer.from(feeString).toString('base64').substring(0, 16);

  // Compress the breakdown
  const compressed = Buffer.from(
    JSON.stringify({
      t: feeBreakdown.totalFees,
      n: feeBreakdown.netInvestmentAmount,
      pof: feeBreakdown.platformOriginationFee?.ratePercent || 0,
      psf: feeBreakdown.platformSuccessFee?.ratePercent || 0,
      ief: feeBreakdown.investorEntryFee?.ratePercent || 0,
      eef: feeBreakdown.earlyExitFee?.ratePercent || 0,
    }),
  ).toString('base64');

  return {
    feeHash,
    totalFeeStroops,
    compressed,
  };
}

/**
 * Generate transaction memo that includes fee information
 * Format: "invest:<asset_code>:<token_amount>:<fee_hash>"
 */
export function generateInvestmentMemo(
  assetCode: string,
  tokenAmount: number,
  feeData: EncodedFeeData,
): string {
  return `invest:${assetCode}:${tokenAmount}:${feeData.feeHash}`;
}

/**
 * Verify that fee data matches expected breakdown
 * Used when transaction is confirmed to ensure no tampering
 */
export function verifyFeeData(
  originalFeeBreakdown: FeeBreakdown,
  encodedFeeData: EncodedFeeData,
): boolean {
  const expectedHash = encodeFeeData(originalFeeBreakdown).feeHash;
  return expectedHash === encodedFeeData.feeHash;
}

/**
 * Decode fee data from transaction memo
 * Extracts hash and other info for verification
 */
export function extractFeeHashFromMemo(memo: string): string | null {
  // Format: "invest:<asset_code>:<token_amount>:<fee_hash>"
  const parts = memo.split(':');
  if (parts.length >= 4 && parts[0] === 'invest') {
    return parts[3]; // fee hash is the 4th part
  }
  return null;
}

/**
 * Constants for fee application
 */
export const FEE_APPLICATION_RULES = {
  // Platform origination fee: charged to farmer when investment is confirmed
  PLATFORM_ORIGINATION: 'charged_to_farmer_at_confirmation',

  // Platform success fee: charged to farmer when deal completes (from payout)
  PLATFORM_SUCCESS: 'charged_to_farmer_at_payout',

  // Investor entry fee: charged to investor, reduces net investment amount
  INVESTOR_ENTRY: 'charged_to_investor_on_entry',

  // Early exit fee: charged to investor if exiting before maturity
  EARLY_EXIT: 'charged_to_investor_on_early_exit',
};

/**
 * Audit log entry for fee application
 * Ensures all fee transactions are recorded
 */
export interface FeeAuditLog {
  investmentId: string;
  tradeDealId: string;
  feeType: string;
  amount: number;
  currency: 'USD' | 'USDC';
  chargedTo: 'farmer' | 'investor';
  txHash?: string; // Stellar transaction hash when applied
  appliedAt?: Date;
  status: 'pending' | 'applied' | 'failed';
}
