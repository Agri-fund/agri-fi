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
    const currentTotal = await this.getAnnualTotal(investorId, currentYear);

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
   * Atomically enforce the annual cap and add an investment amount to the
   * investor's annual total in a single DB operation.
   *
   * Uses a conditional `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE` so the
   * read + compare + increment happen atomically at the database level. This
   * prevents concurrent requests for the same investor from both passing the
   * check and jointly exceeding the cap.
   *
   * When `annualCap` is not finite (no cap for the tier), the amount is simply
   * added without a cap condition.
   *
   * Throws UnprocessableEntityException if the increment would exceed the cap.
   */
  async recordInvestment(
    investorId: string,
    amountUsd: number,
    year?: number,
    annualCap?: number,
  ): Promise<AnnualInvestmentTotal> {
    const currentYear = year ?? new Date().getFullYear();
    const hasCap = annualCap !== undefined && isFinite(annualCap);

    const rows: Array<{ total_usd: string | number }> = await this.annualTotalRepo.query(
      `INSERT INTO annual_investment_totals (investor_id, year, total_usd)
       VALUES ($1, $2, $3)
       ON CONFLICT (investor_id, year) DO UPDATE
         SET total_usd = annual_investment_totals.total_usd + EXCLUDED.total_usd
         WHERE $4::boolean IS NOT TRUE
            OR annual_investment_totals.total_usd + EXCLUDED.total_usd <= $5
       RETURNING total_usd`,
      [investorId, currentYear, amountUsd, hasCap, hasCap ? annualCap : null],
    );

    if (!rows || rows.length === 0) {
      // The conditional UPDATE was rejected: the increment would exceed the cap.
      const currentTotal = await this.getAnnualTotal(investorId, currentYear);
      const cap = annualCap as number;
      const remaining = Math.max(0, cap - currentTotal);
      throw new UnprocessableEntityException({
        code: 'ANNUAL_CAP_EXCEEDED',
        message:
          `Annual investment limit is $${cap.toLocaleString()}. ` +
          `You have invested $${currentTotal.toLocaleString()} this year. ` +
          `Remaining: $${remaining.toLocaleString()}.`,
      });
    }

    const record = await this.annualTotalRepo.findOne({
      where: { investorId, year: currentYear },
    });

    if (!record) {
      return this.annualTotalRepo.create({
        investorId,
        year: currentYear,
        totalUsd: Number(rows[0].total_usd),
      });
    }

    return record;
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
