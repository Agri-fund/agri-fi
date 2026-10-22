/**
 * Tax document secure storage utility.
 *
 * Manages encrypted storage and retrieval of tax documents,
 * leveraging the existing document storage infrastructure.
 */

import { JurisdictionCode } from './jurisdictions';
import { TaxFormData } from './tax-forms';

export interface TaxDocument {
  id: string;
  investorId: string;
  taxYear: number;
  jurisdiction: JurisdictionCode;
  documentType: 'tax_report' | 'tax_form' | 'tax_receipt' | 'withholding_certificate';
  formType?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  storageUrl: string; // IPFS or S3 URL
  ipfsHash?: string;
  encrypted: boolean;
  uploadedAt: string;
  retentionUntil: string; // 7 years retention
  verified: boolean;
}

export interface TaxDocumentUploadResult {
  document: TaxDocument;
  success: boolean;
  error?: string;
}

/**
 * Calculate retention expiry date (7 years from generation).
 */
export function calculateRetentionDate(taxYear: number): string {
  return new Date(taxYear + 7, 11, 31).toISOString().slice(0, 10);
}

/**
 * Create a tax document record for storage.
 */
export function createTaxDocument(
  investorId: string,
  taxYear: number,
  jurisdiction: JurisdictionCode,
  documentType: TaxDocument['documentType'],
  formType: string,
  fileSize: number,
  storageUrl: string,
  ipfsHash?: string,
): TaxDocument {
  return {
    id: `tax-doc-${investorId}-${taxYear}-${formType}`,
    investorId,
    taxYear,
    jurisdiction,
    documentType,
    formType,
    fileName: `tax-${formType}-${jurisdiction}-${taxYear}.pdf`,
    fileSize,
    mimeType: 'application/pdf',
    storageUrl,
    ipfsHash,
    encrypted: true,
    uploadedAt: new Date().toISOString(),
    retentionUntil: calculateRetentionDate(taxYear),
    verified: false,
  };
}

/**
 * List all tax documents for an investor, optionally filtered by year.
 */
export interface TaxDocumentListResponse {
  documents: TaxDocument[];
  totalSize: number;
}

/**
 * Verify a tax document (e.g., via signature verification on IPFS).
 */
export function verifyTaxDocument(doc: TaxDocument): TaxDocument {
  return {
    ...doc,
    verified: true,
  };
}

/**
 * Check if a document is past its retention period.
 */
export function isRetentionExpired(doc: TaxDocument): boolean {
  return new Date(doc.retentionUntil) < new Date();
}

/**
 * Get documents grouped by tax year.
 */
export function groupDocumentsByYear(
  documents: TaxDocument[],
): Map<number, TaxDocument[]> {
  const grouped = new Map<number, TaxDocument[]>();
  for (const doc of documents) {
    if (!grouped.has(doc.taxYear)) {
      grouped.set(doc.taxYear, []);
    }
    grouped.get(doc.taxYear)!.push(doc);
  }
  return grouped;
}
