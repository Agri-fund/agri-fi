/**
 * Tax calculation engine for investor tax automation.
 *
 * Calculates capital gains (long-term and short-term), dividend income,
 * and interest income across multiple jurisdictions using investment data.
 */

import { JurisdictionCode, getTaxTemplate } from './jurisdictions';

// ─── Types ───────────────────────────────────────────────────────────────

export interface InvestmentTaxData {
  dealId: string;
  dealName: string;
  investedAmount: number;
  returnAmount: number;
  feesUsd: number;
  purchaseDate: string; // ISO date when investment was confirmed
  saleDate?: string; // ISO date when return was received (if completed)
  status: 'confirmed' | 'completed' | 'pending' | 'refunded';
  currency: string;
}

export interface CapitalGainResult {
  dealId: string;
  dealName: string;
  investedAmount: number;
  returnAmount: number;
  grossGain: number;
  fees: number;
  netGain: number;
  holdingPeriodDays: number;
  isLongTerm: boolean;
  taxCategory: 'long_term_capital_gains' | 'short_term_capital_gains';
  applicableRate: number;
  estimatedTax: number;
}

export interface DividendIncomeResult {
  dealId: string;
  dealName: string;
  dividendAmount: number;
  taxRate: number;
  estimatedTax: number;
}

export interface InterestIncomeResult {
  source: string;
  amount: number;
  taxRate: number;
  estimatedTax: number;
}

export interface TaxCalculationResult {
  jurisdiction: JurisdictionCode;
  taxYear: number;
  capitalGains: CapitalGainResult[];
  dividendIncome: DividendIncomeResult[];
  interestIncome: InterestIncomeResult[];
  totalLongTermGains: number;
  totalShortTermGains: number;
  totalDividendIncome: number;
  totalInterestIncome: number;
  totalEstimatedTax: number;
  totalFees: number;
  generatedAt: string;
}

// ─── Jurisdiction Tax Rates ─────────────────────────────────────────────

interface JurisdictionTaxRates {
  longTermGainsRate: number;
  shortTermGainsRate: number;
  dividendRate: number;
  interestRate: number;
  longTermThresholdDays: number;
  withholdingRate: number;
}

const JURISDICTION_RATES: Record<JurisdictionCode, JurisdictionTaxRates> = {
  US: {
    longTermGainsRate: 0.15,
    shortTermGainsRate: 0.37,
    dividendRate: 0.15,
    interestRate: 0.37,
    longTermThresholdDays: 365,
    withholdingRate: 0.24,
  },
  UK: {
    longTermGainsRate: 0.20,
    shortTermGainsRate: 0.45,
    dividendRate: 0.3375,
    interestRate: 0.45,
    longTermThresholdDays: 365,
    withholdingRate: 0.20,
  },
  CA: {
    longTermGainsRate: 0.25, // 50% inclusion at ~50% marginal
    shortTermGainsRate: 0.50,
    dividendRate: 0.3829,
    interestRate: 0.50,
    longTermThresholdDays: 365,
    withholdingRate: 0.25,
  },
  AU: {
    longTermGainsRate: 0.225, // 50% discount at 45% marginal
    shortTermGainsRate: 0.45,
    dividendRate: 0.30,
    interestRate: 0.45,
    longTermThresholdDays: 365,
    withholdingRate: 0.325,
  },
  EU: {
    longTermGainsRate: 0.25,
    shortTermGainsRate: 0.40,
    dividendRate: 0.20,
    interestRate: 0.30,
    longTermThresholdDays: 365,
    withholdingRate: 0.20,
  },
  ZA: {
    longTermGainsRate: 0.18, // 40% inclusion at 45% marginal
    shortTermGainsRate: 0.45,
    dividendRate: 0.20,
    interestRate: 0.45,
    longTermThresholdDays: 365,
    withholdingRate: 0.15,
  },
  IN: {
    longTermGainsRate: 0.125, // LTCG on listed securities
    shortTermGainsRate: 0.20,
    dividendRate: 0.30,
    interestRate: 0.30,
    longTermThresholdDays: 730, // India: 2 years for LTCG
    withholdingRate: 0.10,
  },
  SG: {
    longTermGainsRate: 0.0, // Generally exempt
    shortTermGainsRate: 0.0,
    dividendRate: 0.22,
    interestRate: 0.22,
    longTermThresholdDays: 365,
    withholdingRate: 0.0,
  },
};

export function getJurisdictionRates(jurisdiction: JurisdictionCode): JurisdictionTaxRates {
  return JURISDICTION_RATES[jurisdiction] ?? JURISDICTION_RATES.US;
}

// ─── Calculation Functions ──────────────────────────────────────────────

function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.floor((end - start) / (1000 * 60 * 60 * 24));
}

/**
 * Calculate capital gains for a single investment.
 */
export function calculateCapitalGain(
  investment: InvestmentTaxData,
  jurisdiction: JurisdictionCode,
): CapitalGainResult | null {
  if (investment.status !== 'completed' || !investment.saleDate) {
    return null;
  }

  const rates = getJurisdictionRates(jurisdiction);
  const grossGain = investment.returnAmount - investment.investedAmount;
  const netGain = grossGain - investment.feesUsd;
  const holdingPeriodDays = daysBetween(
    investment.purchaseDate,
    investment.saleDate,
  );
  const isLongTerm = holdingPeriodDays >= rates.longTermThresholdDays;
  const applicableRate = isLongTerm
    ? rates.longTermGainsRate
    : rates.shortTermGainsRate;
  const estimatedTax = Math.max(0, netGain) * applicableRate;

  return {
    dealId: investment.dealId,
    dealName: investment.dealName,
    investedAmount: investment.investedAmount,
    returnAmount: investment.returnAmount,
    grossGain,
    fees: investment.feesUsd,
    netGain,
    holdingPeriodDays,
    isLongTerm,
    taxCategory: isLongTerm
      ? 'long_term_capital_gains'
      : 'short_term_capital_gains',
    applicableRate,
    estimatedTax,
  };
}

/**
 * Calculate dividend income from investments that received partial distributions.
 */
export function calculateDividendIncome(
  investment: InvestmentTaxData,
  jurisdiction: JurisdictionCode,
): DividendIncomeResult | null {
  if (investment.status !== 'completed') return null;
  const rates = getJurisdictionRates(jurisdiction);
  const returnExcess = investment.returnAmount - investment.investedAmount;
  // Portion of return exceeding the original investment may be classified as dividend income
  if (returnExcess <= 0) return null;

  // In this platform, the proportional share of deal profits acts as dividend-like income
  const dividendAmount = returnExcess * 0.4; // 40% classified as dividend income
  const estimatedTax = dividendAmount * rates.dividendRate;

  return {
    dealId: investment.dealId,
    dealName: investment.dealName,
    dividendAmount,
    taxRate: rates.dividendRate,
    estimatedTax,
  };
}

/**
 * Calculate interest income from any interest-bearing positions.
 */
export function calculateInterestIncome(
  interestPayments: Array<{ source: string; amount: number }>,
  jurisdiction: JurisdictionCode,
): InterestIncomeResult[] {
  const rates = getJurisdictionRates(jurisdiction);
  return interestPayments.map((payment) => ({
    source: payment.source,
    amount: payment.amount,
    taxRate: rates.interestRate,
    estimatedTax: payment.amount * rates.interestRate,
  }));
}

/**
 * Full tax calculation across all investment data for a tax year.
 */
export function calculateTaxes(
  investments: InvestmentTaxData[],
  jurisdiction: JurisdictionCode,
  taxYear: number,
  interestPayments: Array<{ source: string; amount: number }> = [],
): TaxCalculationResult {
  const template = getTaxTemplate(jurisdiction);
  const yearStart = `${taxYear}-01-01T00:00:00Z`;
  const yearEnd = `${taxYear + 1}-01-01T00:00:00Z`;

  // Filter investments relevant to the tax year
  const relevantInvestments = investments.filter((inv) => {
    const saleDate = inv.saleDate ?? inv.purchaseDate;
    return saleDate >= yearStart && saleDate < yearEnd;
  });

  const capitalGains: CapitalGainResult[] = [];
  const dividendIncome: DividendIncomeResult[] = [];

  for (const inv of relevantInvestments) {
    const gain = calculateCapitalGain(inv, jurisdiction);
    if (gain) capitalGains.push(gain);

    const dividend = calculateDividendIncome(inv, jurisdiction);
    if (dividend) dividendIncome.push(dividend);
  }

  const interestIncome = calculateInterestIncome(interestPayments, jurisdiction);

  const totalLongTermGains = capitalGains
    .filter((g) => g.isLongTerm)
    .reduce((sum, g) => sum + Math.max(0, g.netGain), 0);

  const totalShortTermGains = capitalGains
    .filter((g) => !g.isLongTerm)
    .reduce((sum, g) => sum + Math.max(0, g.netGain), 0);

  const totalDividendIncome = dividendIncome.reduce(
    (sum, d) => sum + d.dividendAmount,
    0,
  );

  const totalInterestIncome = interestIncome.reduce(
    (sum, i) => sum + i.amount,
    0,
  );

  const totalCapitalGainsTax = capitalGains.reduce(
    (sum, g) => sum + g.estimatedTax,
    0,
  );
  const totalDividendTax = dividendIncome.reduce(
    (sum, d) => sum + d.estimatedTax,
    0,
  );
  const totalInterestTax = interestIncome.reduce(
    (sum, i) => sum + i.estimatedTax,
    0,
  );

  const totalFees = relevantInvestments.reduce(
    (sum, inv) => sum + inv.feesUsd,
    0,
  );

  return {
    jurisdiction,
    taxYear,
    capitalGains,
    dividendIncome,
    interestIncome,
    totalLongTermGains,
    totalShortTermGains,
    totalDividendIncome,
    totalInterestIncome,
    totalEstimatedTax:
      totalCapitalGainsTax + totalDividendTax + totalInterestTax,
    totalFees,
    generatedAt: new Date().toISOString(),
  };
}
