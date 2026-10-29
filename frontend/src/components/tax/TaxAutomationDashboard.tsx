'use client';

import { useEffect, useState, useMemo } from 'react';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
import { JurisdictionCode, getTaxTemplate } from '@/lib/tax/jurisdictions';
import {
  calculateTaxes,
  TaxCalculationResult,
  InvestmentTaxData,
} from '@/lib/tax/tax-calculator';
import {
  generateOptimizationSuggestions,
  OptimizationSuggestion,
} from '@/lib/tax/tax-optimization';
import {
  getUpcomingDeadlines,
  generateDeadlineAlerts,
  TaxDeadline,
  DeadlineAlert,
} from '@/lib/tax/tax-deadlines';
import {
  calculateAnnualWithholding,
  WithholdingRecord,
  calculateWithholding,
} from '@/lib/tax/tax-withholding';
import {
  generateTaxForms,
  TaxFormData,
} from '@/lib/tax/tax-forms';
import {
  verifyCompliance,
  ComplianceReport,
  getComplianceBadgeColor,
} from '@/lib/tax/tax-compliance';
import {
  exportTaxData,
  downloadTaxExport,
  AccountantExportData,
  ExportFormat,
} from '@/lib/tax/tax-accountant-export';
import { TaxSettings } from './TaxSettings';
import { TaxReportDownload } from './TaxReportDownload';

type TaxTab = 'overview' | 'calculations' | 'optimization' | 'forms' | 'compliance' | 'accountant' | 'settings';

const CURRENT_YEAR = new Date().getFullYear();
const AVAILABLE_YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i).sort(
  (a, b) => b - a,
);

const PRIORITY_STYLES: Record<string, string> = {
  high: 'bg-red-50 border-red-300 text-red-900',
  medium: 'bg-yellow-50 border-yellow-300 text-yellow-900',
  low: 'bg-blue-50 border-blue-300 text-blue-900',
};

const SEVERITY_STYLES: Record<string, string> = {
  overdue: 'bg-red-100 text-red-800 border-red-300',
  critical: 'bg-orange-100 text-orange-800 border-orange-300',
  warning: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  info: 'bg-blue-100 text-blue-800 border-blue-300',
};

export function TaxAutomationDashboard({
  investorId = 'demo-investor',
  investorName = 'Investor',
  investments = [],
}: {
  investorId?: string;
  investorName?: string;
  investments?: InvestmentTaxData[];
}) {
  const { formatCurrency } = useCurrencyFormat();
  const [tab, setTab] = useState<TaxTab>('overview');
  const [year, setYear] = useState(CURRENT_YEAR);
  const [jurisdiction, setJurisdiction] = useState<JurisdictionCode>('US');
  const [tin, setTin] = useState<string | undefined>(undefined);
  const [withholdingRecords, setWithholdingRecords] = useState<WithholdingRecord[]>([]);

  // Calculate taxes
  const taxResult: TaxCalculationResult = useMemo(() => {
    return calculateTaxes(investments, jurisdiction, year);
  }, [investments, jurisdiction, year]);

  // Generate optimization suggestions
  const suggestions: OptimizationSuggestion[] = useMemo(() => {
    return generateOptimizationSuggestions(
      investments,
      taxResult.capitalGains,
      jurisdiction,
    );
  }, [investments, taxResult, jurisdiction]);

  // Get deadlines
  const deadlines: TaxDeadline[] = useMemo(() => {
    return getUpcomingDeadlines(jurisdiction, 5);
  }, [jurisdiction]);

  const deadlineAlerts: DeadlineAlert[] = useMemo(() => {
    return generateDeadlineAlerts(jurisdiction);
  }, [jurisdiction]);

  // Generate tax forms
  const taxForms: TaxFormData[] = useMemo(() => {
    return generateTaxForms(taxResult, jurisdiction, investorName, tin ?? '');
  }, [taxResult, jurisdiction, investorName, tin]);

  // Verify compliance
  const complianceReport: ComplianceReport = useMemo(() => {
    return verifyCompliance(taxResult, taxForms, tin, jurisdiction);
  }, [taxResult, taxForms, tin, jurisdiction]);

  // Calculate withholding summary
  const withholdingSummary = useMemo(() => {
    return calculateAnnualWithholding(withholdingRecords, year);
  }, [withholdingRecords, year]);

  const template = getTaxTemplate(jurisdiction);

  // Generate withholding records from completed investments
  useEffect(() => {
    const records: WithholdingRecord[] = [];
    for (const inv of investments) {
      if (inv.status === 'completed' && inv.returnAmount > 0) {
        const wh = calculateWithholding(inv.returnAmount, jurisdiction, year);
        records.push({
          id: `wh-${inv.dealId}-${year}`,
          investorId,
          dealId: inv.dealId,
          dealName: inv.dealName,
          taxYear: year,
          grossPayout: wh.grossPayout,
          withholdingRate: wh.withholdingRate,
          withholdingAmount: wh.withholdingAmount,
          netPayout: wh.netPayout,
          jurisdiction,
          withheldAt: wh.withheldAt,
          remittedToAuthority: false,
        });
      }
    }
    setWithholdingRecords(records);
  }, [investments, jurisdiction, year, investorId]);

  const handleExport = (format: ExportFormat) => {
    const exportData: AccountantExportData = {
      jurisdiction,
      taxYear: year,
      investorName,
      investorTIN: tin ?? '',
      taxCalculation: taxResult,
      forms: taxForms,
      withholdingRecords,
      complianceReport,
      exportedAt: new Date().toISOString(),
    };
    downloadTaxExport(exportData, format);
  };

  const tabs: Array<{ key: TaxTab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'calculations', label: 'Tax Calculations' },
    { key: 'optimization', label: 'Optimization' },
    { key: 'forms', label: 'Tax Forms' },
    { key: 'compliance', label: 'Compliance' },
    { key: 'accountant', label: 'Accountant Export' },
    { key: 'settings', label: 'Settings' },
  ];

  return (
    <div className="max-w-5xl mx-auto p-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Tax Automation Center</h1>
        <p className="text-sm text-slate-500 mt-1">
          Calculate, report, and optimize your investment taxes across jurisdictions
        </p>
      </div>

      {/* Year & Jurisdiction Selectors */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">Tax Year</label>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white"
          >
            {AVAILABLE_YEARS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">Jurisdiction</label>
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

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-6 border-b border-slate-200 pb-3">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
              tab === t.key
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === 'overview' && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <p className="text-xs text-slate-500 uppercase">Total Estimated Tax</p>
              <p className="text-xl font-bold text-slate-900">
                {formatCurrency(taxResult.totalEstimatedTax, template.currency, { decimalPlaces: 0 })}
              </p>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <p className="text-xs text-slate-500 uppercase">Long-term Gains</p>
              <p className="text-xl font-bold text-green-600">
                {formatCurrency(taxResult.totalLongTermGains, template.currency, { decimalPlaces: 0 })}
              </p>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <p className="text-xs text-slate-500 uppercase">Short-term Gains</p>
              <p className="text-xl font-bold text-slate-900">
                {formatCurrency(taxResult.totalShortTermGains, template.currency, { decimalPlaces: 0 })}
              </p>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <p className="text-xs text-slate-500 uppercase">Withholding</p>
              <p className="text-xl font-bold text-blue-600">
                {formatCurrency(withholdingSummary.totalWithholding, template.currency, { decimalPlaces: 0 })}
              </p>
            </div>
          </div>

          {/* Deadline Alerts */}
          {deadlineAlerts.length > 0 && (
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <h3 className="font-bold text-slate-900 mb-3">Tax Deadline Alerts</h3>
              <div className="space-y-2">
                {deadlineAlerts.map((alert, idx) => (
                  <div
                    key={idx}
                    className={`flex items-start gap-2 p-3 rounded border ${SEVERITY_STYLES[alert.deadline.severity]}`}
                  >
                    <div className="flex-1">
                      <p className="text-sm font-semibold">{alert.deadline.title}</p>
                      <p className="text-xs mt-1">{alert.message}</p>
                    </div>
                    <span className="text-xs font-bold whitespace-nowrap">
                      {alert.deadline.daysUntilDeadline >= 0
                        ? `${alert.deadline.daysUntilDeadline} days`
                        : `${Math.abs(alert.deadline.daysUntilDeadline)} days overdue`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Compliance Status */}
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-slate-900">Compliance Status</h3>
              <span
                className={`px-3 py-1 text-xs font-bold rounded-full border ${getComplianceBadgeColor(complianceReport.overallStatus)}`}
              >
                {complianceReport.overallStatus.replace('_', ' ').toUpperCase()}
              </span>
            </div>
            <div className="space-y-2">
              {complianceReport.checks.map((check, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      check.status === 'compliant'
                        ? 'bg-green-500'
                        : check.status === 'warning'
                          ? 'bg-yellow-500'
                          : 'bg-red-500'
                    }`}
                  />
                  <span className="text-slate-700">{check.message}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Upcoming Deadlines */}
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-slate-900 mb-3">Upcoming Deadlines</h3>
            <div className="space-y-2">
              {deadlines.map((d) => (
                <div
                  key={d.id}
                  className={`flex items-center justify-between p-3 rounded border ${SEVERITY_STYLES[d.severity]}`}
                >
                  <div>
                    <p className="text-sm font-semibold">{d.title}</p>
                    <p className="text-xs">{d.description}</p>
                  </div>
                  <span className="text-xs font-bold">
                    {d.date} ({d.daysUntilDeadline}d)
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'calculations' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-slate-900 mb-4">Capital Gains Breakdown</h3>
            {taxResult.capitalGains.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">
                No completed investments for tax year {year}.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
                      <th className="pb-2 pr-4">Deal</th>
                      <th className="pb-2 pr-4">Invested</th>
                      <th className="pb-2 pr-4">Returned</th>
                      <th className="pb-2 pr-4">Net Gain</th>
                      <th className="pb-2 pr-4">Days Held</th>
                      <th className="pb-2 pr-4">Term</th>
                      <th className="pb-2 pr-4">Est. Tax</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taxResult.capitalGains.map((g) => (
                      <tr key={g.dealId} className="border-b border-slate-100">
                        <td className="py-2 pr-4 font-medium text-slate-900">{g.dealName}</td>
                        <td className="py-2 pr-4">{formatCurrency(g.investedAmount, template.currency, { decimalPlaces: 0 })}</td>
                        <td className="py-2 pr-4">{formatCurrency(g.returnAmount, template.currency, { decimalPlaces: 0 })}</td>
                        <td className={`py-2 pr-4 ${g.netGain >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatCurrency(g.netGain, template.currency, { decimalPlaces: 0 })}
                        </td>
                        <td className="py-2 pr-4">{g.holdingPeriodDays}d</td>
                        <td className="py-2 pr-4">
                          <span className={g.isLongTerm ? 'text-green-600 font-medium' : 'text-orange-600 font-medium'}>
                            {g.isLongTerm ? 'Long' : 'Short'}
                          </span>
                        </td>
                        <td className="py-2 pr-4">{formatCurrency(g.estimatedTax, template.currency, { decimalPlaces: 0 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <h3 className="font-bold text-slate-900 mb-3">Dividend Income</h3>
              {taxResult.dividendIncome.length === 0 ? (
                <p className="text-sm text-slate-500">No dividend income for this period.</p>
              ) : (
                <div className="space-y-2">
                  {taxResult.dividendIncome.map((d, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span className="text-slate-700">{d.dealName}</span>
                      <span className="font-semibold">
                        {formatCurrency(d.dividendAmount, template.currency, { decimalPlaces: 0 })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <h3 className="font-bold text-slate-900 mb-3">Interest Income</h3>
              {taxResult.interestIncome.length === 0 ? (
                <p className="text-sm text-slate-500">No interest income for this period.</p>
              ) : (
                <div className="space-y-2">
                  {taxResult.interestIncome.map((i, idx) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span className="text-slate-700">{i.source}</span>
                      <span className="font-semibold">
                        {formatCurrency(i.amount, template.currency, { decimalPlaces: 0 })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Withholding Summary */}
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-slate-900 mb-3">Withholding at Source</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-slate-500">Gross Payout</p>
                <p className="font-bold text-slate-900">
                  {formatCurrency(withholdingSummary.totalGrossPayout, template.currency, { decimalPlaces: 0 })}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Tax Withheld</p>
                <p className="font-bold text-blue-600">
                  {formatCurrency(withholdingSummary.totalWithholding, template.currency, { decimalPlaces: 0 })}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Net Payout</p>
                <p className="font-bold text-green-600">
                  {formatCurrency(withholdingSummary.totalNetPayout, template.currency, { decimalPlaces: 0 })}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'optimization' && (
        <div className="space-y-4">
          <h3 className="font-bold text-slate-900">Tax Optimization Suggestions</h3>
          {suggestions.length === 0 ? (
            <p className="text-sm text-slate-500 bg-slate-50 p-4 rounded-lg">
              No optimization opportunities found for your current portfolio.
            </p>
          ) : (
            suggestions.map((s) => (
              <div
                key={s.id}
                className={`p-4 rounded-lg border ${PRIORITY_STYLES[s.priority]}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="font-bold">{s.title}</h4>
                      <span className="px-2 py-0.5 text-xs font-bold uppercase rounded bg-white/50">
                        {s.priority}
                      </span>
                    </div>
                    <p className="text-sm">{s.description}</p>
                    {s.potentialSavings > 0 && (
                      <p className="text-sm font-semibold mt-2">
                        Potential savings: {formatCurrency(s.potentialSavings, template.currency, { decimalPlaces: 2 })}
                      </p>
                    )}
                    {s.actionUrl && (
                      <a
                        href={s.actionUrl}
                        className="inline-block mt-2 text-sm text-blue-600 hover:text-blue-700 font-semibold"
                      >
                        {s.actionLabel ?? 'Take Action'}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'forms' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-900">Generated Tax Forms</h3>
            <span className="text-xs text-slate-500">{jurisdiction} tax year {year}</span>
          </div>
          {taxForms.length === 0 ? (
            <p className="text-sm text-slate-500 bg-slate-50 p-4 rounded-lg">
              No tax forms to generate for this period.
            </p>
          ) : (
            taxForms.map((form) => (
              <div key={form.formType} className="bg-white rounded-lg border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-bold text-slate-900">{form.formType.toUpperCase()}</h4>
                  <span className="text-sm font-semibold text-slate-600">
                    Total: {formatCurrency(form.totalAmount, template.currency, { decimalPlaces: 2 })}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {Object.entries(form.fields).map(([key, value]) => (
                    <div key={key}>
                      <span className="text-slate-500 text-xs">{key.replace(/_/g, ' ')}:</span>
                      <span className="font-semibold ml-2 text-slate-900">{value}</span>
                    </div>
                  ))}
                </div>
                {form.lineItems.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Line Items</p>
                    <div className="space-y-1">
                      {form.lineItems.map((item, idx) => (
                        <div key={idx} className="flex justify-between text-xs">
                          <span className="text-slate-700">
                            {item.boxNumber && `[${item.boxNumber}] `}
                            {item.description}
                          </span>
                          <span className="font-semibold text-slate-900">
                            {formatCurrency(item.amount, template.currency, { decimalPlaces: 2 })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
          <div className="bg-slate-50 rounded-lg p-4">
            <h4 className="font-bold text-slate-900 mb-2">Download Reports</h4>
            <TaxReportDownload />
          </div>
        </div>
      )}

      {tab === 'compliance' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-900">Compliance Verification Report</h3>
              <span
                className={`px-4 py-1.5 text-sm font-bold rounded-full border ${getComplianceBadgeColor(complianceReport.overallStatus)}`}
              >
                {complianceReport.overallStatus.replace('_', ' ').toUpperCase()}
              </span>
            </div>

            {complianceReport.errors.length > 0 && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded">
                <p className="text-xs font-bold text-red-700 uppercase mb-1">Errors</p>
                {complianceReport.errors.map((err, idx) => (
                  <p key={idx} className="text-sm text-red-700">{err}</p>
                ))}
              </div>
            )}

            {complianceReport.warnings.length > 0 && (
              <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
                <p className="text-xs font-bold text-yellow-700 uppercase mb-1">Warnings</p>
                {complianceReport.warnings.map((warn, idx) => (
                  <p key={idx} className="text-sm text-yellow-700">{warn}</p>
                ))}
              </div>
            )}

            <div className="space-y-3">
              {complianceReport.checks.map((check, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <div
                    className={`mt-1 w-3 h-3 rounded-full flex-shrink-0 ${
                      check.status === 'compliant'
                        ? 'bg-green-500'
                        : check.status === 'warning'
                          ? 'bg-yellow-500'
                          : 'bg-red-500'
                    }`}
                  />
                  <div>
                    <p className="text-sm font-medium text-slate-900">{check.message}</p>
                    {check.details && (
                      <p className="text-xs text-slate-500 mt-1">{check.details}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'accountant' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-slate-900 mb-2">Export for Accountant Review</h3>
            <p className="text-sm text-slate-600 mb-4">
              Export your complete tax data in a format suitable for your accountant or tax software.
              The export includes all calculations, generated forms, withholding records, and compliance verification.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <button
                onClick={() => handleExport('csv')}
                className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 text-sm"
              >
                CSV Bundle
              </button>
              <button
                onClick={() => handleExport('json')}
                className="px-4 py-2 bg-slate-700 text-white font-semibold rounded-md hover:bg-slate-800 text-sm"
              >
                JSON Export
              </button>
              <button
                onClick={() => handleExport('quickbooks_csv')}
                className="px-4 py-2 bg-green-600 text-white font-semibold rounded-md hover:bg-green-700 text-sm"
              >
                QuickBooks CSV
              </button>
              <button
                onClick={() => handleExport('turbotax_csv')}
                className="px-4 py-2 bg-purple-600 text-white font-semibold rounded-md hover:bg-purple-700 text-sm"
              >
                TurboTax CSV
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <h4 className="font-bold text-slate-900 mb-2">Export Contents</h4>
            <ul className="text-sm text-slate-600 space-y-1">
              <li>• {taxResult.capitalGains.length} capital gains transactions</li>
              <li>• {taxResult.dividendIncome.length} dividend income records</li>
              <li>• {taxResult.interestIncome.length} interest income records</li>
              <li>• {withholdingRecords.length} withholding records</li>
              <li>• {taxForms.length} generated tax forms ({jurisdiction})</li>
              <li>• Compliance verification: {complianceReport.overallStatus.replace('_', ' ')}</li>
              <li>• Total estimated tax: {formatCurrency(taxResult.totalEstimatedTax, template.currency, { decimalPlaces: 2 })}</li>
            </ul>
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="space-y-6">
          <TaxSettings />
        </div>
      )}
    </div>
  );
}
