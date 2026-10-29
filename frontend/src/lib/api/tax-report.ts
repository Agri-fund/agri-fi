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

// ─── Tax Automation API Endpoints ────────────────────────────────────────

/**
 * Fetches tax calculation results for a year and jurisdiction.
 */
export async function getTaxCalculation(
  year: number,
  jurisdiction: JurisdictionCode,
  token?: string,
): Promise<unknown> {
  const response = await fetch(
    `/api/tax/calculation?year=${year}&jurisdiction=${jurisdiction}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch tax calculation: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetches tax optimization suggestions.
 */
export async function getTaxOptimization(
  year: number,
  token?: string,
): Promise<unknown> {
  const response = await fetch(`/api/tax/optimization?year=${year}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch tax optimization: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetches withholding records for a tax year.
 */
export async function getTaxWithholding(
  year: number,
  token?: string,
): Promise<unknown> {
  const response = await fetch(`/api/tax/withholding?year=${year}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch withholding: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetches tax deadline alerts.
 */
export async function getTaxDeadlines(
  year: number,
  token?: string,
): Promise<unknown> {
  const response = await fetch(`/api/tax/deadlines?year=${year}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch tax deadlines: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetches compliance verification report.
 */
export async function getTaxCompliance(
  year: number,
  token?: string,
): Promise<unknown> {
  const response = await fetch(`/api/tax/compliance?year=${year}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch compliance: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Exports tax data for accountant review.
 */
export async function exportForAccountant(
  year: number,
  format: 'csv' | 'json' | 'quickbooks_csv' | 'turbotax_csv' = 'csv',
  token?: string,
): Promise<Blob> {
  const response = await fetch(
    `/api/tax/accountant-export?year=${year}&format=${format}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to export for accountant: ${response.statusText}`);
  }
  return response.blob();
}

/**
 * Fetches stored tax documents.
 */
export async function getTaxDocuments(
  year: number,
  token?: string,
): Promise<unknown> {
  const response = await fetch(`/api/tax/documents?year=${year}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch tax documents: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Uploads a tax document for secure storage.
 */
export async function uploadTaxDocument(
  data: {
    taxYear: number;
    jurisdiction: JurisdictionCode;
    documentType: string;
    fileName: string;
  },
  token?: string,
): Promise<unknown> {
  const response = await fetch('/api/tax/documents', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(`Failed to upload tax document: ${response.statusText}`);
  }
  return response.json();
}
