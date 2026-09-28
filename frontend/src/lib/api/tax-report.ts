import { JurisdictionCode } from '@/lib/tax/jurisdictions';

export type TaxReportFormat = 'csv' | 'pdf';

export interface TaxCategory {
  key: string;
  label: string;
  amount: number;
  percentage: number;
}

export interface TaxReportSummary {
  year: number;
  jurisdiction: JurisdictionCode;
  currency: string;
  generatedAt: string;
  categories: TaxCategory[];
  totalGainLoss: number;
  totalInvested: number;
  totalFees: number;
  disclaimer: string;
}

export interface TaxReportRow {
  dealName: string;
  investedAmount: string;
  returnReceived: string;
  netGainLoss: string;
  feesUsd: string;
  currency: string;
  closedAt: string;
}

export interface TaxReportData {
  year: number;
  investorId: string;
  jurisdiction: JurisdictionCode;
  rows: TaxReportRow[];
  totals: { currency: string; netGainLoss: number }[];
  generatedAt: string;
  disclaimer: string;
}

/**
 * Fetches tax report summary for a specific year and jurisdiction.
 */
export async function getTaxReportSummary(
  year: number,
  jurisdiction: JurisdictionCode,
  token?: string,
): Promise<TaxReportSummary> {
  const response = await fetch(
    `/api/tax-reports/summary?year=${year}&jurisdiction=${jurisdiction}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch tax report: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetches full tax report data.
 */
export async function getTaxReportData(
  year: number,
  format: TaxReportFormat = 'csv',
  jurisdiction?: JurisdictionCode,
  token?: string,
): Promise<TaxReportData | Blob> {
  const params = new URLSearchParams({
    year: String(year),
    format,
    ...(jurisdiction && { jurisdiction }),
  });

  const response = await fetch(`/api/tax-reports?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch tax report: ${response.statusText}`);
  }

  // For binary formats, return blob
  if (format === 'pdf') {
    return response.blob();
  }

  return response.json();
}

/**
 * Saves user tax settings (jurisdiction, TIN).
 */
export async function saveTaxSettings(
  settings: {
    jurisdiction: JurisdictionCode;
    tin?: string; // Encrypted on backend
    tinEncrypted?: boolean;
    preferredFormat?: TaxReportFormat;
  },
  token?: string,
): Promise<void> {
  const response = await fetch('/api/tax-settings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(settings),
  });

  if (!response.ok) {
    throw new Error(`Failed to save tax settings: ${response.statusText}`);
  }
}

/**
 * Retrieves user tax settings.
 */
export async function getTaxSettings(
  token?: string,
): Promise<{
  jurisdiction: JurisdictionCode;
  tin?: string; // Masked for security
  preferredFormat: TaxReportFormat;
}> {
  const response = await fetch('/api/tax-settings', {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch tax settings: ${response.statusText}`);
  }

  return response.json();
}
