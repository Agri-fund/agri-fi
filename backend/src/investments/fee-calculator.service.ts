import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThan, IsNull } from 'typeorm';
import {
  FeeConfiguration,
  FeeType,
  InvestorTier,
} from '../database/entities/fee-configuration.entity';
import { User } from '../auth/entities/user.entity';

/**
 * Represents a single calculated fee line item
 */
export interface FeeLineItem {
  type: FeeType;
  description: string;
  ratePercent: number;
  amount: number; // in USD
  effectiveFrom: Date;
}

/**
 * Complete fee breakdown for an investment
 */
export interface FeeBreakdown {
  grossAmount: number; // Original investment amount
  platformOriginationFee: FeeLineItem | null;
  platformSuccessFee: FeeLineItem | null; // Estimated based on configuration
  investorEntryFee: FeeLineItem | null;
  earlyExitFee: FeeLineItem | null;
  totalFees: number;
  netInvestmentAmount: number; // Amount actually invested after entry fees
  breakdown: FeeLineItem[];
}

/**
 * Configuration for fee calculation
 */
export interface FeeCalculationConfig {
  dealType: string; // Commodity name from TradeDeal
  investorTier: InvestorTier;
  grossAmount: number; // Investment amount in USD
  isEarlyExit?: boolean; // If true, apply early exit fee instead of normal fees
  referenceDate?: Date; // Date to check fee effectiveness (default: now)
}

@Injectable()
export class FeeCalculatorService {
  constructor(
    @InjectRepository(FeeConfiguration)
    private readonly feeConfigRepo: Repository<FeeConfiguration>,
  ) {}

  /**
   * Calculate complete fee breakdown for an investment
   */
  async calculateFeeBreakdown(
    config: FeeCalculationConfig,
  ): Promise<FeeBreakdown> {
    const referenceDate = config.referenceDate || new Date();
    const breakdown: FeeLineItem[] = [];
    let totalFees = 0;

    // Get applicable fee configurations
    const fees = await this.getApplicableFees(
      config.dealType,
      config.investorTier,
      referenceDate,
    );

    if (!fees || fees.length === 0) {
      throw new NotFoundException(
        `No fee configuration found for deal type "${config.dealType}" and tier "${config.investorTier}"`,
      );
    }

    let platformOriginationFee: FeeLineItem | null = null;
    let platformSuccessFee: FeeLineItem | null = null;
    let investorEntryFee: FeeLineItem | null = null;
    let earlyExitFee: FeeLineItem | null = null;

    // Process each fee type
    for (const feeConfig of fees) {
      if (config.isEarlyExit && feeConfig.feeType !== FeeType.EARLY_EXIT) {
        // Skip non-early-exit fees if this is an early exit
        continue;
      }

      if (!config.isEarlyExit && feeConfig.feeType === FeeType.EARLY_EXIT) {
        // Skip early exit fee if this is normal investment
        continue;
      }

      const lineItem = this.calculateFeeLineItem(feeConfig, config.grossAmount);
      breakdown.push(lineItem);
      totalFees += lineItem.amount;

      // Categorize by fee type
      switch (feeConfig.feeType) {
        case FeeType.PLATFORM_ORIGINATION:
          platformOriginationFee = lineItem;
          break;
        case FeeType.PLATFORM_SUCCESS:
          platformSuccessFee = lineItem;
          break;
        case FeeType.INVESTOR_ENTRY:
          investorEntryFee = lineItem;
          break;
        case FeeType.EARLY_EXIT:
          earlyExitFee = lineItem;
          break;
      }
    }

    // Net investment amount = gross - entry fees (only entry fees reduce the amount invested)
    const investorEntryFeeAmount = investorEntryFee?.amount || 0;
    const netInvestmentAmount = config.grossAmount - investorEntryFeeAmount;

    return {
      grossAmount: config.grossAmount,
      platformOriginationFee,
      platformSuccessFee,
      investorEntryFee,
      earlyExitFee,
      totalFees,
      netInvestmentAmount,
      breakdown,
    };
  }

  /**
   * Get all applicable fees for a deal type and investor tier at a given date
   */
  private async getApplicableFees(
    dealType: string,
    investorTier: InvestorTier,
    referenceDate: Date,
  ): Promise<FeeConfiguration[]> {
    return await this.feeConfigRepo.find({
      where: [
        {
          dealType,
          investorTier,
          effectiveFrom: LessThanOrEqual(referenceDate),
          effectiveTo: MoreThan(referenceDate),
        },
        {
          dealType,
          investorTier,
          effectiveFrom: LessThanOrEqual(referenceDate),
          effectiveTo: IsNull(),
        },
      ],
      order: {
        feeType: 'ASC',
      },
    });
  }

  /**
   * Calculate a single fee line item based on configuration
   */
  private calculateFeeLineItem(
    config: FeeConfiguration,
    baseAmount: number,
  ): FeeLineItem {
    const amount = (baseAmount * config.ratePercent) / 100;

    return {
      type: config.feeType,
      description:
        config.description ||
        this.getDefaultFeeDescription(config.feeType, config.investorTier),
      ratePercent: config.ratePercent,
      amount: Math.round(amount * 100) / 100, // Round to 2 decimal places
      effectiveFrom: config.effectiveFrom,
    };
  }

  /**
   * Get default description for a fee type if not provided
   */
  private getDefaultFeeDescription(
    feeType: FeeType,
    tier: InvestorTier,
  ): string {
    const descriptions: Record<FeeType, string> = {
      [FeeType.PLATFORM_ORIGINATION]: 'Platform origination fee',
      [FeeType.PLATFORM_SUCCESS]: 'Platform success fee',
      [FeeType.INVESTOR_ENTRY]: `Investor entry fee (${tier})`,
      [FeeType.EARLY_EXIT]: 'Early exit penalty fee',
    };
    return descriptions[feeType] || 'Fee';
  }

  /**
   * Get investor tier from user role (can be extended with user attributes)
   * For now: admin/company_admin -> institutional, no role -> retail
   * This can be extended to check user profile for tier information
   */
  getInvestorTierFromUser(user: User): InvestorTier {
    // Simple mapping - can be extended to check user account tier
    // In production, this might look up user subscription level, AUM, etc.
    if (user.role === 'company_admin' || user.role === 'admin') {
      return InvestorTier.INSTITUTIONAL;
    }

    // Default to retail unless we have a way to know otherwise
    return InvestorTier.RETAIL;
  }

  /**
   * Validate that a deal type has fee configurations
   */
  async validateDealTypeHasConfigurations(
    dealType: string,
    referenceDate?: Date,
  ): Promise<boolean> {
    const date = referenceDate || new Date();
    const count = await this.feeConfigRepo.count({
      where: [
        {
          dealType,
          effectiveFrom: LessThanOrEqual(date),
          effectiveTo: MoreThan(date),
        },
        {
          dealType,
          effectiveFrom: LessThanOrEqual(date),
          effectiveTo: IsNull(),
        },
      ],
    });
    return count > 0;
  }
}
