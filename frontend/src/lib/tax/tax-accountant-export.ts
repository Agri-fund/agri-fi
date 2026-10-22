/**
 * Tax accountant export utilities.
 *
 * Exports tax data in formats suitable for accountant review:
 * CSV bundles, JSON exports, and QuickBooks/TurboTax-compatible formats.
 */

import { JurisdictionCode } from './jurisdictions';
import { TaxCalculationResult } from './tax-calculator';
import { TaxFormData } from './tax-forms';
import { WithholdingRecord } from './tax-withholding';
import { ComplianceReport } from './tax-compliance';

export type ExportFormat = 'csv' | 'json' | 'quickbooks_csv' | 'turbotax_csv';

export interface AccountantExportData {
  jurisdiction: JurisdictionCode;
  taxYear: number;
  investorName: string;
  investorTIN: string;
  taxCalculation: TaxCalculationResult;
  forms: TaxFormData[];
  withholdingRecords: WithholdingRecord[];
  complianceReport: ComplianceReport;
  exportedAt: string;
}

/**
 * Export complete tax data as JSON for accountant review.
 */
export function exportAsJSON(data: AccountantExportData): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Generate a CSV bundle string for accountant export.
 */
export function exportAsCSV(data: AccountantExportData): string {
  const sections: string[] = [];

  // Header
  sections.push('# Tax Export for Accountant Review');
  sections.push(`# Investor: ${data.investorName}`);
  sections.push(`# Jurisdiction: ${data.jurisdiction}`);
  sections.push(`# Tax Year: ${data.taxYear}`);
  sections.push(`# Generated: ${data.exportedAt}`);
  sections.push('');

  // Capital Gains
  sections.push('## CAPITAL GAINS');
  sections.push('Deal Name,Invested,Returned,Gross Gain,Fees,Net Gain,Holding Days,Term,Rate,Estimated Tax');
  for (const cg of data.taxCalculation.capitalGains) {
    sections.push([
      `"${cg.dealName}"`,
      cg.investedAmount.toFixed(2),
      cg.returnAmount.toFixed(2),
      cg.grossGain.toFixed(2),
      cg.fees.toFixed(2),
      cg.netGain.toFixed(2),
      cg.holdingPeriodDays,
      cg.isLongTerm ? 'Long-term' : 'Short-term',
      (cg.applicableRate * 100).toFixed(1) + '%',
      cg.estimatedTax.toFixed(2),
    ].join(','));
  }
  sections.push('');

  // Dividend Income
  sections.push('## DIVIDEND INCOME');
  sections.push('Deal Name,Amount,Rate,Estimated Tax');
  for (const div of data.taxCalculation.dividendIncome) {
    sections.push([
      `"${div.dealName}"`,
      div.dividendAmount.toFixed(2),
      (div.taxRate * 100).toFixed(1) + '%',
      div.estimatedTax.toFixed(2),
    ].join(','));
  }
  sections.push('');

  // Interest Income
  sections.push('## INTEREST INCOME');
  sections.push('Source,Amount,Rate,Estimated Tax');
  for (const interest of data.taxCalculation.interestIncome) {
    sections.push([
      `"${interest.source}"`,
      interest.amount.toFixed(2),
      (interest.taxRate * 100).toFixed(1) + '%',
      interest.estimatedTax.toFixed(2),
    ].join(','));
  }
  sections.push('');

  // Withholding
  sections.push('## WITHHOLDING');
  sections.push('Deal Name,Gross Payout,Rate,Withheld,Net Payout,Remitted');
  for (const wh of data.withholdingRecords) {
    sections.push([
      `"${wh.dealName}"`,
      wh.grossPayout.toFixed(2),
      (wh.withholdingRate * 100).toFixed(1) + '%',
      wh.withholdingAmount.toFixed(2),
      wh.netPayout.toFixed(2),
      wh.remittedToAuthority ? 'Yes' : 'No',
    ].join(','));
  }
  sections.push('');

  // Summary
  sections.push('## SUMMARY');
  sections.push(`Total Long-term Gains,${data.taxCalculation.totalLongTermGains.toFixed(2)}`);
  sections.push(`Total Short-term Gains,${data.taxCalculation.totalShortTermGains.toFixed(2)}`);
  sections.push(`Total Dividend Income,${data.taxCalculation.totalDividendIncome.toFixed(2)}`);
  sections.push(`Total Interest Income,${data.taxCalculation.totalInterestIncome.toFixed(2)}`);
  sections.push(`Total Estimated Tax,${data.taxCalculation.totalEstimatedTax.toFixed(2)}`);
  sections.push(`Total Fees,${data.taxCalculation.totalFees.toFixed(2)}`);
  sections.push('');

  // Compliance
  sections.push('## COMPLIANCE STATUS');
  sections.push(`Overall Status,${data.complianceReport.overallStatus}`);
  for (const check of data.complianceReport.checks) {
    sections.push(`${check.type},${check.status},"${check.message}"`);
  }
  sections.push('');

  // Forms
  sections.push('## TAX FORMS');
  sections.push('Form Type,Total Amount,Generated At');
  for (const form of data.forms) {
    sections.push(`${form.formType},${form.totalAmount.toFixed(2)},${form.generatedAt}`);
  }

  return sections.join('\n');
}

/**
 * Export in QuickBooks-compatible CSV format.
 */
export function exportForQuickBooks(data: AccountantExportData): string {
  const lines: string[] = [];
  lines.push('Date,Ref No,Account Name,Amount,Type,Memo');

  for (const cg of data.taxCalculation.capitalGains) {
    lines.push([
      new Date(cg.dealId).toISOString().slice(0, 10) || data.taxCalculation.generatedAt.slice(0, 10),
      cg.dealId,
      'Capital Gains',
      cg.netGain.toFixed(2),
      cg.netGain >= 0 ? 'Credit' : 'Debit',
      `"${cg.dealName} - ${cg.isLongTerm ? 'LT' : 'ST'} gain"`,
    ].join(','));
  }

  for (const div of data.taxCalculation.dividendIncome) {
    lines.push([
      data.taxCalculation.generatedAt.slice(0, 10),
      div.dealId,
      'Dividend Income',
      div.dividendAmount.toFixed(2),
      'Credit',
      `"${div.dealName} dividend"`,
    ].join(','));
  }

  for (const interest of data.taxCalculation.interestIncome) {
    lines.push([
      data.taxCalculation.generatedAt.slice(0, 10),
      'INT',
      'Interest Income',
      interest.amount.toFixed(2),
      'Credit',
      `"${interest.source} interest"`,
    ].join(','));
  }

  return lines.join('\n');
}

/**
 * Export in TurboTax-compatible CSV format.
 */
export function exportForTurboTax(data: AccountantExportData): string {
  const lines: string[] = [];
  lines.push('Category,Description,Date Acquired,Date Sold,Proceeds,Cost Basis,Gain/Loss,Holding Period');

  for (const cg of data.taxCalculation.capitalGains) {
    lines.push([
      'Investment Sale',
      `"${cg.dealName}"`,
      cg.dealId,
      data.taxCalculation.generatedAt.slice(0, 10),
      cg.returnAmount.toFixed(2),
      cg.investedAmount.toFixed(2),
      cg.netGain.toFixed(2),
      cg.isLongTerm ? 'Long' : 'Short',
    ].join(','));
  }

  return lines.join('\n');
}

/**
 * Export tax data in the specified format.
 */
export function exportTaxData(
  data: AccountantExportData,
  format: ExportFormat = 'csv',
): string {
  switch (format) {
    case 'json':
      return exportAsJSON(data);
    case 'csv':
      return exportAsCSV(data);
    case 'quickbooks_csv':
      return exportForQuickBooks(data);
    case 'turbotax_csv':
      return exportForTurboTax(data);
    default:
      return exportAsCSV(data);
  }
}

/**
 * Download exported tax data as a file.
 */
export function downloadTaxExport(
  data: AccountantExportData,
  format: ExportFormat = 'csv',
): void {
  const content = exportTaxData(data, format);
  const extension = format === 'json' ? 'json' : 'csv';
  const filename = `tax-export-${data.jurisdiction}-${data.taxYear}.${extension}`;
  const blob = new Blob([content], {
    type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
