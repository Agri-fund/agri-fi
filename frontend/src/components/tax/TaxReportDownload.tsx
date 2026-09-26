'use client';

import { useEffect, useState } from 'react';
import {
  getTaxReportSummary,
  getTaxReportData,
  TaxReportFormat,
  TaxReportSummary,
  TaxReportData,
} from '@/lib/api/tax-report';
import { getTaxTemplate, JurisdictionCode } from '@/lib/tax/jurisdictions';

const CURRENT_YEAR = new Date().getFullYear();
const AVAILABLE_YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i).sort(
  (a, b) => b - a,
);

export function TaxReportDownload() {
  const [year, setYear] = useState(CURRENT_YEAR);
  const [jurisdiction, setJurisdiction] = useState<JurisdictionCode>('US');
  const [summary, setSummary] = useState<TaxReportSummary | null>(null);
  const [format, setFormat] = useState<TaxReportFormat>('csv');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const template = getTaxTemplate(jurisdiction);

  // Load tax report summary
  useEffect(() => {
    const loadSummary = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getTaxReportSummary(year, jurisdiction);
        setSummary(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tax report');
        setSummary(null);
      } finally {
        setLoading(false);
      }
    };

    loadSummary();
  }, [year, jurisdiction]);

  const handleDownload = async () => {
    try {
      setDownloading(true);
      setError(null);

      const data = await getTaxReportData(year, format, jurisdiction);

      // Handle PDF blob
      if (format === 'pdf' && data instanceof Blob) {
        const url = URL.createObjectURL(data);
        const link = document.createElement('a');
        link.href = url;
        link.download = `tax-report-${jurisdiction}-${year}.pdf`;
        link.click();
        URL.revokeObjectURL(url);
        return;
      }

      // Handle CSV blob (convert to text if needed)
      if (format === 'csv') {
        if (data instanceof Blob) {
          const text = await data.text();
          downloadCSV(text, `tax-report-${jurisdiction}-${year}.csv`);
        } else {
          // Generate CSV from data
          const csv = generateCSV(data as TaxReportData);
          downloadCSV(csv, `tax-report-${jurisdiction}-${year}.csv`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download report');
    } finally {
      setDownloading(false);
    }
  };

  const downloadCSV = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const generateCSV = (data: TaxReportData): string => {
    const lines: string[] = [];

    // Header
    lines.push(`Tax Report - ${jurisdiction} ${data.year}`);
    lines.push(`Generated: ${new Date(data.generatedAt).toLocaleDateString()}`);
    lines.push('');

    // Summary
    const total = data.totals[0];
    lines.push('SUMMARY');
    lines.push(`Total Invested,${summary?.totalInvested || 0}`);
    lines.push(`Total Gain/Loss,"${total.netGainLoss.toFixed(2)}"`);
    lines.push(`Total Fees,"${summary?.totalFees || 0}"`);
    lines.push('');

    // Details
    lines.push('TRANSACTION DETAILS');
    lines.push(
      'Deal Name,Invested Amount,Return Received,Net Gain/Loss,Fees,Currency,Closed At',
    );

    for (const row of data.rows) {
      lines.push(
        [
          `"${row.dealName.replace(/"/g, '""')}"`,
          row.investedAmount,
          row.returnReceived,
          row.netGainLoss,
          row.feesUsd,
          row.currency,
          row.closedAt,
        ].join(','),
      );
    }

    lines.push('');
    lines.push('DISCLAIMER');
    lines.push(`"${data.disclaimer}"`);

    return lines.join('\n');
  };

  return (
    <div className="max-w-2xl bg-white rounded-lg border border-slate-200 p-6 shadow-sm">
      <h2 className="text-lg font-bold text-slate-900 mb-6">Download Tax Report</h2>

      {/* Selectors */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">Year</label>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white"
          >
            {AVAILABLE_YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">
            Jurisdiction
          </label>
          <select
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value as JurisdictionCode)}
            className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white"
          >
            <option value="US">United States</option>
            <option value="UK">United Kingdom</option>
            <option value="CA">Canada</option>
            <option value="AU">Australia</option>
            <option value="EU">European Union</option>
            <option value="ZA">South Africa</option>
            <option value="IN">India</option>
            <option value="SG">Singapore</option>
          </select>
        </div>
      </div>

      {/* Format Selection */}
      <div className="mb-6">
        <label className="block text-sm font-semibold text-slate-700 mb-3">Format</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="format"
              value="csv"
              checked={format === 'csv'}
              onChange={() => setFormat('csv')}
            />
            <span className="text-sm">CSV (Excel)</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="format"
              value="pdf"
              checked={format === 'pdf'}
              onChange={() => setFormat('pdf')}
            />
            <span className="text-sm">PDF</span>
          </label>
        </div>
      </div>

      {/* Summary */}
      {loading ? (
        <div className="bg-slate-50 rounded p-4 mb-6 text-center text-slate-600">
          Loading tax report...
        </div>
      ) : summary ? (
        <div className="bg-slate-50 rounded p-4 mb-6">
          <h3 className="font-semibold text-slate-900 mb-3">{template.country} Summary</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-slate-600">Total Invested</p>
              <p className="font-bold text-slate-900">
                {summary.currency} {summary.totalInvested.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-slate-600">Net Gain/Loss</p>
              <p
                className={`font-bold ${summary.totalGainLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}
              >
                {summary.currency} {summary.totalGainLoss.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-slate-600">Platform Fees</p>
              <p className="font-bold text-slate-900">
                {summary.currency} {summary.totalFees.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-slate-600">Tax Categories</p>
              <p className="font-bold text-slate-900">{summary.categories.length} types</p>
            </div>
          </div>

          {/* Tax Categories Breakdown */}
          <div className="mt-4 pt-4 border-t border-slate-200">
            <p className="text-xs font-semibold text-slate-700 uppercase mb-2">Tax Breakdown</p>
            <div className="space-y-2">
              {summary.categories.map((cat) => (
                <div key={cat.key} className="flex justify-between text-xs">
                  <span className="text-slate-700">{cat.label}</span>
                  <span className="font-semibold text-slate-900">
                    {cat.percentage.toFixed(1)}% ({summary.currency} {cat.amount.toFixed(0)})
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Disclaimer */}
          <div className="mt-4 pt-4 border-t border-slate-200">
            <p className="text-xs text-slate-600 italic">{summary.disclaimer}</p>
          </div>
        </div>
      ) : (
        !error && (
          <div className="bg-slate-50 rounded p-4 mb-6 text-center text-slate-600">
            No tax data available for this period.
          </div>
        )
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 mb-6">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Download Button */}
      <button
        onClick={handleDownload}
        disabled={downloading || !summary}
        className="w-full px-4 py-2 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 disabled:bg-slate-300"
      >
        {downloading ? 'Downloading...' : `Download as ${format.toUpperCase()}`}
      </button>
    </div>
  );
}
