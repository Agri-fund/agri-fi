/**
 * Jurisdiction-specific tax information and templates.
 * Localized tax breakdowns per country requirements.
 */

export type JurisdictionCode = 'US' | 'UK' | 'CA' | 'AU' | 'EU' | 'ZA' | 'IN' | 'SG';

export interface TaxReportTemplate {
  jurisdiction: JurisdictionCode;
  country: string;
  language: string;
  categories: TaxCategory[];
  disclaimer: string;
  currency: string;
}

export interface TaxCategory {
  key: string;
  label: string;
  description: string;
  taxRate?: number; // If fixed rate
}

/**
 * Localized tax report templates by jurisdiction.
 * Maps categories of investment income per tax authority.
 */
export const TAX_TEMPLATES: Record<JurisdictionCode, TaxReportTemplate> = {
  US: {
    jurisdiction: 'US',
    country: 'United States',
    language: 'en',
    categories: [
      {
        key: 'capital_gains',
        label: 'Capital Gains (Long-term)',
        description: 'Profit from agricultural investment deals held > 1 year',
        taxRate: undefined, // Varies by income bracket
      },
      {
        key: 'capital_gains_short',
        label: 'Capital Gains (Short-term)',
        description: 'Profit from deals held ≤ 1 year (ordinary income rates)',
      },
      {
        key: 'interest_dividend',
        label: 'Interest & Dividend Income',
        description: 'Payments from platform during investment holding period',
      },
      {
        key: 'platform_fees',
        label: 'Platform Fees (Deductible)',
        description: 'Investment advisory fees, may be deductible',
      },
    ],
    disclaimer:
      'This report is for informational purposes only. Consult a US tax professional (CPA/EA) regarding capital gains tax treatment, holding periods, and deductions. The IRS may classify income differently.',
    currency: 'USD',
  },
  UK: {
    jurisdiction: 'UK',
    country: 'United Kingdom',
    language: 'en',
    categories: [
      {
        key: 'capital_gains',
        label: 'Chargeable Gains',
        description: 'Profits subject to Capital Gains Tax (CGT)',
      },
      {
        key: 'interest_income',
        label: 'Savings Income',
        description: 'Interest and dividend-equivalent payments',
        taxRate: 20, // Standard dividend allowance 1000 GBP or 500 for savings
      },
      {
        key: 'platform_fees',
        label: 'Investment Costs (Allowable)',
        description: 'Fees paid for investment management',
      },
    ],
    disclaimer:
      'This report is for informational purposes only. For UK tax reporting, consult a qualified tax advisor. Capital Gains Tax and Income Tax treatment depends on your individual circumstances. Report on Self Assessment tax return (SA 302).',
    currency: 'GBP',
  },
  CA: {
    jurisdiction: 'CA',
    country: 'Canada',
    language: 'en',
    categories: [
      {
        key: 'capital_gains',
        label: 'Capital Gains (50% Inclusion)',
        description: 'Only 50% of capital gains are taxable in Canada',
      },
      {
        key: 'dividend_income',
        label: 'Investment Income (Dividends)',
        description: 'Dividend-equivalent payments subject to gross-up',
      },
      {
        key: 'investment_expenses',
        label: 'Investment Expenses (Deductible)',
        description: 'Platform fees and investment-related costs',
      },
    ],
    disclaimer:
      'This report is for informational purposes only. Canadian investors should report income on their T1 General income tax return. Consult a Canadian tax professional regarding the 50% capital gains inclusion rate and dividend tax credit implications.',
    currency: 'CAD',
  },
  AU: {
    jurisdiction: 'AU',
    country: 'Australia',
    language: 'en',
    categories: [
      {
        key: 'capital_gains',
        label: 'Capital Gains (50% Discount)',
        description: 'Capital gains with 50% CGT discount for long-term holdings',
      },
      {
        key: 'ordinary_income',
        label: 'Ordinary Income (Dividends)',
        description: 'Income from investments subject to full tax rate',
      },
      {
        key: 'deductible_expenses',
        label: 'Deductible Expenses',
        description: 'Investment fees, platform costs',
      },
      {
        key: 'foreign_investment',
        label: 'Foreign Investment Rules',
        description: 'If applicable, special rules for non-resident investors',
      },
    ],
    disclaimer:
      'This report is for informational purposes only. Australian investors must report on their tax return (ITR). The 50% CGT discount applies to assets held > 12 months. Consult an Australian tax accountant, especially regarding Foreign Investment Review Board (FIRB) implications.',
    currency: 'AUD',
  },
  EU: {
    jurisdiction: 'EU',
    country: 'European Union',
    language: 'en',
    categories: [
      {
        key: 'capital_gains',
        label: 'Capital Gains Tax',
        description: 'Treated differently per EU member state',
      },
      {
        key: 'investment_income',
        label: 'Investment Income',
        description: 'Dividend-like payments and interest',
      },
      {
        key: 'investment_deductions',
        label: 'Deductible Investment Costs',
        description: 'Platform fees and advisory costs',
      },
      {
        key: 'vat_consideration',
        label: 'VAT Consideration',
        description: 'May be exempt under financial services rules',
      },
    ],
    disclaimer:
      'This report is for informational purposes. EU member states have varying tax rules. Consult a tax professional in your specific country for proper classification (especially regarding VAT exemption for financial services).',
    currency: 'EUR',
  },
  ZA: {
    jurisdiction: 'ZA',
    country: 'South Africa',
    language: 'en',
    categories: [
      {
        key: 'capital_gains',
        label: 'Capital Gains Tax (40% Inclusion)',
        description: 'Only 40% of capital gains included in taxable income (individuals)',
      },
      {
        key: 'dividend_income',
        label: 'Local Dividend Income',
        description: 'Dividend tax credit (DTC) applicable at 20%',
      },
      {
        key: 'foreign_investment',
        label: 'Foreign Investment Income',
        description: 'Foreign source income subject to normal tax',
      },
      {
        key: 'deductible_expenses',
        label: 'Deductible Expenses',
        description: 'Investment costs (platform fees, advisory)',
      },
    ],
    disclaimer:
      'This report is for informational purposes. SARS (South African Revenue Service) requires reporting on tax return (ITR12). Note 40% capital gains inclusion, dividend tax credit, and foreign investment income rules. Consult a South African tax professional.',
    currency: 'ZAR',
  },
  IN: {
    jurisdiction: 'IN',
    country: 'India',
    language: 'en',
    categories: [
      {
        key: 'capital_gains_long',
        label: 'Long-term Capital Gains (LTCG)',
        description: 'Assets held > 2 years, lower tax rate + indexation benefit',
      },
      {
        key: 'capital_gains_short',
        label: 'Short-term Capital Gains (STCG)',
        description: 'Assets held ≤ 2 years, taxed as ordinary income',
      },
      {
        key: 'dividend_income',
        label: 'Dividend Income',
        description: 'Subject to DDT and personal income tax',
      },
      {
        key: 'investment_expenses',
        label: 'Investment Expenses',
        description: 'Platform fees (may be deductible under Schedule III)',
      },
    ],
    disclaimer:
      'This report is for informational purposes. Indian tax residents must report on income tax return (ITR). Note: long-term holding period is > 2 years, with indexation benefit on LTCG. Consult an Indian Chartered Accountant regarding LTCG rate and TCS implications.',
    currency: 'INR',
  },
  SG: {
    jurisdiction: 'SG',
    country: 'Singapore',
    language: 'en',
    categories: [
      {
        key: 'capital_gains',
        label: 'Capital Gains (Generally Exempt)',
        description: 'Capital gains from trading are generally not taxed',
      },
      {
        key: 'dividend_income',
        label: 'Dividend Income',
        description: 'Subject to tax at marginal rate if from Singapore-derived income',
      },
      {
        key: 'foreign_source',
        label: 'Foreign Source Income',
        description: 'Foreign dividends only taxed if remitted to Singapore',
      },
      {
        key: 'expense_deduction',
        label: 'Expense Deduction',
        description: 'Investment-related expenses may be deductible',
      },
    ],
    disclaimer:
      'This report is for informational purposes. Singapore has a favorable capital gains tax treatment (generally exempt). However, dividend tax treatment depends on source and remittance. Consult Singapore tax advisor regarding foreign investment income.',
    currency: 'SGD',
  },
};

/**
 * Gets tax template for a jurisdiction with localized labels.
 */
export function getTaxTemplate(jurisdiction: JurisdictionCode): TaxReportTemplate {
  return TAX_TEMPLATES[jurisdiction] || TAX_TEMPLATES.US;
}

/**
 * Gets all jurisdiction options with tax template info.
 */
export function getJurisdictionTemplateOptions(): Array<{
  value: JurisdictionCode;
  label: string;
  country: string;
  currency: string;
}> {
  return Object.values(TAX_TEMPLATES).map((t) => ({
    value: t.jurisdiction,
    label: t.country,
    country: t.country,
    currency: t.currency,
  }));
}
