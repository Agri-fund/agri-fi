/**
 * Tax withholding at source calculation and management.
 *
 * Automatically withholds taxes from investment returns at the time of payout,
 * based on the investor's jurisdiction and applicable withholding rates.
 */

import { JurisdictionCode } from './jurisdictions';
import { getJurisdictionRates } from './tax-calculator';

export interface WithholdingResult {
  grossPayout: number;
  withholdingRate: number;
  withholdingAmount: number;
  netPayout: number;
  jurisdiction: JurisdictionCode;
  withheldAt: string;
}

export interface WithholdingRecord {
  id: string;
  investorId: string;
  dealId: string;
  dealName: string;
  taxYear: number;
  grossPayout: number;
  withholdingRate: number;
  withholdingAmount: number;
  netPayout: number;
  jurisdiction: JurisdictionCode;
  withheldAt: string;
  remittedToAuthority: boolean;
  remittedAt?: string;
}

/**
 * Calculate withholding tax for a payout.
 */
export function calculateWithholding(
  payoutAmount: number,
  jurisdiction: JurisdictionCode,
  taxYear: number = new Date().getFullYear(),
): WithholdingResult {
  const rates = getJurisdictionRates(jurisdiction);
  const withholdingAmount = payoutAmount * rates.withholdingRate;
  const netPayout = payoutAmount - withholdingAmount;

  return {
    grossPayout: payoutAmount,
    withholdingRate: rates.withholdingRate,
    withholdingAmount,
    netPayout,
    jurisdiction,
    withheldAt: new Date().toISOString(),
  };
}

/**
 * Create a withholding record for a completed investment payout.
 */
export function createWithholdingRecord(
  investorId: string,
  dealId: string,
  dealName: string,
  payoutAmount: number,
  jurisdiction: JurisdictionCode,
  taxYear: number = new Date().getFullYear(),
): WithholdingRecord {
  const result = calculateWithholding(payoutAmount, jurisdiction, taxYear);

  return {
    id: `wh-${dealId}-${taxYear}`,
    investorId,
    dealId,
    dealName,
    taxYear,
    grossPayout: result.grossPayout,
    withholdingRate: result.withholdingRate,
    withholdingAmount: result.withholdingAmount,
    netPayout: result.netPayout,
    jurisdiction,
    withheldAt: result.withheldAt,
    remittedToAuthority: false,
  };
}

/**
 * Calculate total withholding for an investor across all payouts in a tax year.
 */
export function calculateAnnualWithholding(
  records: WithholdingRecord[],
  taxYear: number,
): {
  totalGrossPayout: number;
  totalWithholding: number;
  totalNetPayout: number;
  records: WithholdingRecord[];
} {
  const yearRecords = records.filter((r) => r.taxYear === taxYear);

  return {
    totalGrossPayout: yearRecords.reduce((sum, r) => sum + r.grossPayout, 0),
    totalWithholding: yearRecords.reduce((sum, r) => sum + r.withholdingAmount, 0),
    totalNetPayout: yearRecords.reduce((sum, r) => sum + r.netPayout, 0),
    records: yearRecords,
  };
}
