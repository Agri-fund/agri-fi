import {
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnnualInvestmentTotal } from './entities/annual-investment-total.entity';
import {
  ANNUAL_CAP_USD,
  PER_DEAL_CAP_USD,
  tierSatisfies,
} from '../auth/entities/user.entity';
import type { AccreditationTier } from '../auth/entities/user.entity';

@Injectable()
export class AnnualCapService {
  constructor(
    @InjectRepository(AnnualInvestmentTotal)
    private readonly annualTotalRepo: Repository<AnnualInvestmentTotal>,
  ) {}

  /**
   * Enforce both per-deal and annual investment caps for an investor.
   * Throws UnprocessableEntityException if either limit is exceeded.
   */
  async enforceCaps(
    investorId: string,
    tier: AccreditationTier,
    amountUsd: number,
    dealMinimumTier: AccreditationTier,
  ): Promise<void> {
    // 1. Check tier eligibility for this deal
    if (!tierSatisfies(tier, dealMinimumTier)) {
      throw new UnprocessableEntityException({
        code: 'TIER_INSUFFICIENT',
        message: `This deal requires ${dealMinimumTier} accreditation or higher. Your current tier is ${tier}. Please apply for accreditation to access this deal.`,
      });
    }

    // 2. Per-deal cap
    const perDealCap = PER_DEAL_CAP_USD[tier];
    if (isFinite(perDealCap) && amountUsd > perDealCap) {
      throw new UnprocessableEntityException({
        code: 'PER_DEAL_CAP_EXCEEDED',
        message: `Your ${tier} tier allows a maximum of $${perDealCap.toLocaleString()} per deal. Requested: $${amountUsd.toLocaleString()}.`,
      });
    }

    // 3. Annual cap
    const annualCap = ANNUAL_CAP_USD[tier];
    if (!isFinite(annualCap)) return; // institutional / accredited have no annual cap

    const currentYear = new Date().getFullYear();
    const record = await this.annualTotalRepo.findOne({
      where: { investorId, year: currentYear },
    });

    const currentTotal = record ? Number(record.totalUsd) : 0;
    if (currentTotal + amountUsd > annualCap) {
      const remaining = Math.max(0, annualCap - currentTotal);
      throw new UnprocessableEntityException({
        code: 'ANNUAL_CAP_EXCEEDED',
        message:
          `Annual investment limit for ${tier} tier is $${annualCap.toLocaleString()}. ` +
          `You have invested $${currentTotal.toLocaleString()} this year. ` +
          `Remaining: $${remaining.toLocaleString()}.`,
      });
    }
  }

  /**
   * Add an investment amount to the investor's annual total.
   * Called after an investment is successfully created.
   */
  async recordInvestment(
    investorId: string,
    amountUsd: number,
    year?: number,
  ): Promise<AnnualInvestmentTotal> {
    const currentYear = year ?? new Date().getFullYear();

    let record = await this.annualTotalRepo.findOne({
      where: { investorId, year: currentYear },
    });

    if (!record) {
      record = this.annualTotalRepo.create({
        investorId,
        year: currentYear,
        totalUsd: 0,
      });
    }

    record.totalUsd = Number(record.totalUsd) + amountUsd;
    return this.annualTotalRepo.save(record);
  }

  /**
   * Get the annual invested total for an investor for the current year.
   */
  async getAnnualTotal(investorId: string, year?: number): Promise<number> {
    const targetYear = year ?? new Date().getFullYear();
    const record = await this.annualTotalRepo.findOne({
      where: { investorId, year: targetYear },
    });
    return record ? Number(record.totalUsd) : 0;
  }

  /**
   * Reset all investors' annual totals to 0 for the new year.
   * Called by the Jan 1 cron job.
   * Creates new zero-total records for the new year; does not delete old records.
   */
  async resetAnnualTotals(newYear: number): Promise<void> {
    await this.annualTotalRepo.query(
      `INSERT INTO annual_investment_totals (investor_id, year, total_usd)
       SELECT investor_id, $1, 0
       FROM annual_investment_totals
       WHERE year = $2
       ON CONFLICT (investor_id, year) DO UPDATE SET total_usd = 0`,
      [newYear, newYear - 1],
    );
  }
}
