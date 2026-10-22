/**
 * Tax form generation for investor tax reports.
 *
 * Generates data structures for IRS Form 1099, Schedule D, and
 * international tax forms across supported jurisdictions.
 */

import { JurisdictionCode } from './jurisdictions';
import { TaxCalculationResult, CapitalGainResult } from './tax-calculator';

export type TaxFormType =
  | '1099-DIV'
  | '1099-INT'
  | '1099-B'
  | 'schedule_d'
  | 'sa302'
  | 't5008'
  | 'cgt_schedule'
  | 'itr_capital_gains'
  | 'form_b';

export interface TaxFormData {
  formType: TaxFormType;
  jurisdiction: JurisdictionCode;
  taxYear: number;
  investorName: string;
  investorTIN: string;
  fields: Record<string, string | number>;
  lineItems: TaxFormLineItem[];
  totalAmount: number;
  generatedAt: string;
}

export interface TaxFormLineItem {
  description: string;
  amount: number;
  boxNumber?: string;
}

// ─── US Forms ────────────────────────────────────────────────────────────

export function generate1099DIV(
  taxResult: TaxCalculationResult,
  investorName: string,
  tin: string,
): TaxFormData {
  const totalDividends = taxResult.totalDividendIncome;
  const totalCapitalGains = taxResult.capitalGains
    .filter((g) => g.isLongTerm)
    .reduce((sum, g) => sum + Math.max(0, g.netGain), 0);

  return {
    formType: '1099-DIV',
    jurisdiction: 'US',
    taxYear: taxResult.taxYear,
    investorName,
    investorTIN: tin,
    fields: {
      '1a_total_ordinary_dividends': totalDividends.toFixed(2),
      '1b_qualified_dividends': totalDividends.toFixed(2),
      '2a_total_capital_gain_distr': totalCapitalGains.toFixed(2),
      '4_federal_income_tax_withheld': taxResult.totalEstimatedTax.toFixed(2),
    },
    lineItems: taxResult.dividendIncome.map((d) => ({
      description: `Dividend income from ${d.dealName}`,
      amount: d.dividendAmount,
      boxNumber: '1a',
    })),
    totalAmount: totalDividends + totalCapitalGains,
    generatedAt: new Date().toISOString(),
  };
}

export function generate1099INT(
  taxResult: TaxCalculationResult,
  investorName: string,
  tin: string,
): TaxFormData {
  const totalInterest = taxResult.totalInterestIncome;

  return {
    formType: '1099-INT',
    jurisdiction: 'US',
    taxYear: taxResult.taxYear,
    investorName,
    investorTIN: tin,
    fields: {
      '1_interest_income': totalInterest.toFixed(2),
      '4_federal_income_tax_withheld': taxResult.interestIncome.reduce(
        (sum, i) => sum + i.estimatedTax, 0,
      ).toFixed(2),
    },
    lineItems: taxResult.interestIncome.map((i) => ({
      description: `Interest income from ${i.source}`,
      amount: i.amount,
      boxNumber: '1',
    })),
    totalAmount: totalInterest,
    generatedAt: new Date().toISOString(),
  };
}

export function generate1099B(
  taxResult: TaxCalculationResult,
  investorName: string,
  tin: string,
): TaxFormData {
  return {
    formType: '1099-B',
    jurisdiction: 'US',
    taxYear: taxResult.taxYear,
    investorName,
    investorTIN: tin,
    fields: {
      'proceeds': taxResult.capitalGains.reduce((s, g) => s + g.returnAmount, 0).toFixed(2),
      'cost_basis': taxResult.capitalGains.reduce((s, g) => s + g.investedAmount, 0).toFixed(2),
      'gain_or_loss': taxResult.capitalGains.reduce((s, g) => s + g.netGain, 0).toFixed(2),
      'federal_tax_withheld': taxResult.capitalGains.reduce((s, g) => s + g.estimatedTax, 0).toFixed(2),
    },
    lineItems: taxResult.capitalGains.map((g) => ({
      description: `${g.dealName} - ${g.isLongTerm ? 'Long-term' : 'Short-term'} capital ${g.netGain >= 0 ? 'gain' : 'loss'}`,
      amount: g.netGain,
    })),
    totalAmount: taxResult.capitalGains.reduce((s, g) => s + g.netGain, 0),
    generatedAt: new Date().toISOString(),
  };
}

export function generateScheduleD(
  taxResult: TaxCalculationResult,
  investorName: string,
  tin: string,
): TaxFormData {
  const shortTerm = taxResult.capitalGains.filter((g) => !g.isLongTerm);
  const longTerm = taxResult.capitalGains.filter((g) => g.isLongTerm);

  return {
    formType: 'schedule_d',
    jurisdiction: 'US',
    taxYear: taxResult.taxYear,
    investorName,
    investorTIN: tin,
    fields: {
      'part_i_short_term_proceeds': shortTerm.reduce((s, g) => s + g.returnAmount, 0).toFixed(2),
      'part_i_short_term_cost': shortTerm.reduce((s, g) => s + g.investedAmount, 0).toFixed(2),
      'part_i_short_term_gain': shortTerm.reduce((s, g) => s + g.netGain, 0).toFixed(2),
      'part_ii_long_term_proceeds': longTerm.reduce((s, g) => s + g.returnAmount, 0).toFixed(2),
      'part_ii_long_term_cost': longTerm.reduce((s, g) => s + g.investedAmount, 0).toFixed(2),
      'part_ii_long_term_gain': longTerm.reduce((s, g) => s + g.netGain, 0).toFixed(2),
      'line_16_total_gain': taxResult.totalLongTermGains + taxResult.totalShortTermGains,
    },
    lineItems: [
      ...shortTerm.map((g) => ({
        description: `Part I - ${g.dealName} (short-term, ${g.holdingPeriodDays}d)`,
        amount: g.netGain,
      })),
      ...longTerm.map((g) => ({
        description: `Part II - ${g.dealName} (long-term, ${g.holdingPeriodDays}d)`,
        amount: g.netGain,
      })),
    ],
    totalAmount: taxResult.totalLongTermGains + taxResult.totalShortTermGains,
    generatedAt: new Date().toISOString(),
  };
}

// ─── UK Forms ────────────────────────────────────────────────────────────

export function generateSA302(
  taxResult: TaxCalculationResult,
  investorName: string,
  tin: string,
): TaxFormData {
  return {
    formType: 'sa302',
    jurisdiction: 'UK',
    taxYear: taxResult.taxYear,
    investorName,
    investorTIN: tin,
    fields: {
      'sa105_dividends': taxResult.totalDividendIncome.toFixed(2),
      'sa105_interest': taxResult.totalInterestIncome.toFixed(2),
      'sa108_capital_gains': (taxResult.totalLongTermGains + taxResult.totalShortTermGains).toFixed(2),
      'tax_deducted': taxResult.totalEstimatedTax.toFixed(2),
    },
    lineItems: [
      ...taxResult.capitalGains.map((g) => ({
        description: `Chargeable gain: ${g.dealName} (${g.holdingPeriodDays}d holding period)`,
        amount: g.netGain,
      })),
      ...taxResult.dividendIncome.map((d) => ({
        description: `Dividend: ${d.dealName}`,
        amount: d.dividendAmount,
      })),
    ],
    totalAmount: taxResult.totalLongTermGains + taxResult.totalShortTermGains + taxResult.totalDividendIncome,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Canada Forms ────────────────────────────────────────────────────────

export function generateT5008(
  taxResult: TaxCalculationResult,
  investorName: string,
  tin: string,
): TaxFormData {
  return {
    formType: 't5008',
    jurisdiction: 'CA',
    taxYear: taxResult.taxYear,
    investorName,
    investorTIN: tin,
    fields: {
      'proceeds_of_disposition': taxResult.capitalGains.reduce((s, g) => s + g.returnAmount, 0).toFixed(2),
      'adjusted_cost_base': taxResult.capitalGains.reduce((s, g) => s + g.investedAmount, 0).toFixed(2),
      'outlays_expenses': taxResult.capitalGains.reduce((s, g) => s + g.fees, 0).toFixed(2),
      'gain_or_loss': taxResult.capitalGains.reduce((s, g) => s + g.netGain, 0).toFixed(2),
    },
    lineItems: taxResult.capitalGains.map((g) => ({
      description: `${g.dealName} - ${g.isLongTerm ? 'Long-term' : 'Short-term'} (50% inclusion)`,
      amount: g.netGain,
    })),
    totalAmount: taxResult.capitalGains.reduce((s, g) => s + g.netGain, 0),
    generatedAt: new Date().toISOString(),
  };
}

// ─── International Forms ──────────────────────────────────────────────────

export function generateInternationalForm(
  taxResult: TaxCalculationResult,
  jurisdiction: JurisdictionCode,
  investorName: string,
  tin: string,
): TaxFormData {
  const formTypeMap: Partial<Record<JurisdictionCode, TaxFormType>> = {
    AU: 'cgt_schedule',
    IN: 'itr_capital_gains',
    SG: 'form_b',
  };

  return {
    formType: formTypeMap[jurisdiction] ?? 'cgt_schedule',
    jurisdiction,
    taxYear: taxResult.taxYear,
    investorName,
    investorTIN: tin,
    fields: {
      'capital_gains': (taxResult.totalLongTermGains + taxResult.totalShortTermGains).toFixed(2),
      'dividend_income': taxResult.totalDividendIncome.toFixed(2),
      'interest_income': taxResult.totalInterestIncome.toFixed(2),
      'total_estimated_tax': taxResult.totalEstimatedTax.toFixed(2),
    },
    lineItems: taxResult.capitalGains.map((g) => ({
      description: `${g.dealName} - ${g.isLongTerm ? 'Long-term' : 'Short-term'} gain`,
      amount: g.netGain,
    })),
    totalAmount: taxResult.totalLongTermGains + taxResult.totalShortTermGains,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Form Selection ──────────────────────────────────────────────────────

export function generateTaxForms(
  taxResult: TaxCalculationResult,
  jurisdiction: JurisdictionCode,
  investorName: string,
  tin: string,
): TaxFormData[] {
  const forms: TaxFormData[] = [];

  switch (jurisdiction) {
    case 'US':
      forms.push(generate1099DIV(taxResult, investorName, tin));
      forms.push(generate1099INT(taxResult, investorName, tin));
      forms.push(generate1099B(taxResult, investorName, tin));
      forms.push(generateScheduleD(taxResult, investorName, tin));
      break;
    case 'UK':
      forms.push(generateSA302(taxResult, investorName, tin));
      break;
    case 'CA':
      forms.push(generateT5008(taxResult, investorName, tin));
      break;
    default:
      forms.push(generateInternationalForm(taxResult, jurisdiction, investorName, tin));
      break;
  }

  return forms;
}
