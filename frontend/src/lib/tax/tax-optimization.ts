/**
 * Tax optimization suggestions for investors.
 *
 * Analyzes investment portfolios to suggest tax-loss harvesting,
 * long-term holding strategies, and other tax optimization opportunities.
 */

import { InvestmentTaxData, CapitalGainResult } from './tax-calculator';
import { JurisdictionCode, getJurisdictionRates } from './tax-calculator';

export type OptimizationType =
  | 'tax_loss_harvesting'
  | 'long_term_holding'
  | 'fee_deduction'
  | 'jurisdiction_optimization'
  | 'timing_optimization';

export interface OptimizationSuggestion {
  id: string;
  type: OptimizationType;
  title: string;
  description: string;
  potentialSavings: number;
  priority: 'high' | 'medium' | 'low';
  actionUrl?: string;
  actionLabel?: string;
}

export interface LossHarvestingOpportunity {
  dealId: string;
  dealName: string;
  investedAmount: number;
  currentValue: number;
  unrealizedLoss: number;
  taxSavings: number;
}

/**
 * Identify investments with unrealized losses for tax-loss harvesting.
 */
export function findLossHarvestingOpportunities(
  investments: InvestmentTaxData[],
  jurisdiction: JurisdictionCode,
): LossHarvestingOpportunity[] {
  const rates = getJurisdictionRates(jurisdiction);
  const opportunities: LossHarvestingOpportunity[] = [];

  for (const inv of investments) {
    if (inv.status !== 'confirmed') continue;

    const currentValue = inv.returnAmount || inv.investedAmount;
    const unrealizedLoss = inv.investedAmount - currentValue;

    if (unrealizedLoss > 0) {
      opportunities.push({
        dealId: inv.dealId,
        dealName: inv.dealName,
        investedAmount: inv.investedAmount,
        currentValue,
        unrealizedLoss,
        taxSavings: unrealizedLoss * rates.shortTermGainsRate,
      });
    }
  }

  return opportunities.sort((a, b) => b.taxSavings - a.taxSavings);
}

/**
 * Identify investments approaching long-term holding threshold.
 */
export function findLongTermHoldingOpportunities(
  investments: InvestmentTaxData[],
  jurisdiction: JurisdictionCode,
): Array<{
  dealId: string;
  dealName: string;
  daysHeld: number;
  daysToLongTerm: number;
  estimatedTaxSavings: number;
}> {
  const rates = getJurisdictionRates(jurisdiction);
  const now = new Date().toISOString();
  const opportunities: Array<{
    dealId: string;
    dealName: string;
    daysHeld: number;
    daysToLongTerm: number;
    estimatedTaxSavings: number;
  }> = [];

  for (const inv of investments) {
    if (inv.status !== 'confirmed') continue;

    const daysHeld = Math.floor(
      (new Date(now).getTime() - new Date(inv.purchaseDate).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    const daysToLongTerm = rates.longTermThresholdDays - daysHeld;

    // If within 60 days of long-term threshold
    if (daysToLongTerm > 0 && daysToLongTerm <= 60) {
      const estimatedGain = inv.returnAmount - inv.investedAmount;
      if (estimatedGain > 0) {
        const shortTermTax = estimatedGain * rates.shortTermGainsRate;
        const longTermTax = estimatedGain * rates.longTermGainsRate;
        const savings = shortTermTax - longTermTax;

        opportunities.push({
          dealId: inv.dealId,
          dealName: inv.dealName,
          daysHeld,
          daysToLongTerm,
          estimatedTaxSavings: savings,
        });
      }
    }
  }

  return opportunities.sort((a, b) => b.estimatedTaxSavings - a.estimatedTaxSavings);
}

/**
 * Generate comprehensive tax optimization suggestions.
 */
export function generateOptimizationSuggestions(
  investments: InvestmentTaxData[],
  capitalGains: CapitalGainResult[],
  jurisdiction: JurisdictionCode,
): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];

  // 1. Tax-loss harvesting
  const lossOpportunities = findLossHarvestingOpportunities(investments, jurisdiction);
  for (const opp of lossOpportunities.slice(0, 3)) {
    suggestions.push({
      id: `harvest-${opp.dealId}`,
      type: 'tax_loss_harvesting',
      title: `Harvest losses on ${opp.dealName}`,
      description: `Selling this position realizes a $${opp.unrealizedLoss.toFixed(2)} loss, which can offset capital gains and save approximately $${opp.taxSavings.toFixed(2)} in taxes.`,
      potentialSavings: opp.taxSavings,
      priority: opp.taxSavings > 500 ? 'high' : 'medium',
      actionUrl: `/marketplace/${opp.dealId}`,
      actionLabel: 'View Position',
    });
  }

  // 2. Long-term holding
  const holdingOpportunities = findLongTermHoldingOpportunities(investments, jurisdiction);
  for (const opp of holdingOpportunities.slice(0, 3)) {
    suggestions.push({
      id: `hold-${opp.dealId}`,
      type: 'long_term_holding',
      title: `Hold ${opp.dealName} for ${opp.daysToLongTerm} more days`,
      description: `This position is ${opp.daysHeld} days old. Holding for ${opp.daysToLongTerm} more days qualifies for long-term capital gains rates, saving approximately $${opp.estimatedTaxSavings.toFixed(2)}.`,
      potentialSavings: opp.estimatedTaxSavings,
      priority: opp.estimatedTaxSavings > 200 ? 'high' : 'medium',
    });
  }

  // 3. Fee deduction
  const totalFees = capitalGains.reduce((sum, g) => sum + g.fees, 0);
  if (totalFees > 0) {
    const rates = getJurisdictionRates(jurisdiction);
    const feeSavings = totalFees * rates.shortTermGainsRate;
    suggestions.push({
      id: 'fee-deduction',
      type: 'fee_deduction',
      title: 'Deduct platform fees from taxable income',
      description: `You paid $${totalFees.toFixed(2)} in platform fees. These may be deductible as investment expenses, potentially saving $${feeSavings.toFixed(2)} in taxes.`,
      potentialSavings: feeSavings,
      priority: 'low',
    });
  }

  // 4. Jurisdiction optimization
  const hasShortTerm = capitalGains.some((g) => !g.isLongTerm && g.netGain > 0);
  if (hasShortTerm && jurisdiction === 'US') {
    suggestions.push({
      id: 'jurisdiction-opt',
      type: 'jurisdiction_optimization',
      title: 'Review short-term gains exposure',
      description: 'You have short-term capital gains taxed at ordinary income rates. Consider strategies to convert to long-term holdings or offset with losses.',
      potentialSavings: 0,
      priority: 'medium',
    });
  }

  // 5. Timing optimization
  const totalShortTermGains = capitalGains
    .filter((g) => !g.isLongTerm && g.netGain > 0)
    .reduce((sum, g) => sum + g.netGain, 0);
  if (totalShortTermGains > 1000) {
    suggestions.push({
      id: 'timing-opt',
      type: 'timing_optimization',
      title: 'Consider staggering gains across tax years',
      description: `You have $${totalShortTermGains.toFixed(2)} in short-term gains. Spreading sales across multiple tax years can reduce your marginal tax bracket exposure.`,
      potentialSavings: 0,
      priority: 'medium',
    });
  }

  return suggestions.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}
