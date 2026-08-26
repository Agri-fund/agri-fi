import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import { AnnualInvestmentCap } from './entities/annual-investment-cap.entity';
import { AccreditationTier } from './entities/user.entity';

@Injectable()
export class AnnualCapService {
  /** Annual investment caps in USD per accreditation tier. */
  static readonly CAPS: Record<AccreditationTier, number> = {
    retail: 5_000,
    accredited: 250_000,
    institutional: Infinity,
  };

  constructor(
    @InjectRepository(AnnualInvestmentCap)
    private readonly capRepo: Repository<AnnualInvestmentCap>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AnnualCapService.name);
  }

  /**
   * Returns the existing cap record for the given user+year, or creates a new
   * one with totalInvested=0 if none exists yet.
   */
  async getOrCreateCap(userId: string, year: number): Promise<AnnualInvestmentCap> {
    let cap = await this.capRepo.findOne({ where: { userId, year } });
    if (!cap) {
      cap = this.capRepo.create({ userId, year, totalInvested: 0 });
      cap = await this.capRepo.save(cap);
    }
    return cap;
  }

  /**
   * Adds amountUsd to the investor's annual cap for the current calendar year.
   */
  async addInvestment(userId: string, amountUsd: number): Promise<void> {
    const year = new Date().getFullYear();
    const cap = await this.getOrCreateCap(userId, year);

    await this.capRepo.update(cap.id, {
      totalInvested: Number(cap.totalInvested) + amountUsd,
    });

    this.logger.info({ userId, amountUsd, year }, 'Annual cap updated after investment');
  }

  /**
   * Checks whether an investor can invest amountUsd without exceeding their
   * annual cap based on their accreditation tier.
   *
   * @param userId        - investor user ID
   * @param amountUsd     - proposed investment amount
   * @param tier          - current effective accreditation tier of the user
   */
  async checkCap(
    userId: string,
    amountUsd: number,
    tier: AccreditationTier,
  ): Promise<{ allowed: boolean; remainingUsd: number }> {
    const year = new Date().getFullYear();
    const cap = await this.getOrCreateCap(userId, year);
    const annualLimit = AnnualCapService.CAPS[tier];

    if (annualLimit === Infinity) {
      return { allowed: true, remainingUsd: Infinity };
    }

    const currentTotal = Number(cap.totalInvested);
    const remainingUsd = annualLimit - currentTotal;
    const allowed = remainingUsd >= amountUsd;

    return { allowed, remainingUsd };
  }

  /**
   * Runs on January 1st each year. Creates fresh cap records (totalInvested=0)
   * for the new year for all users who had a cap record in the previous year.
   */
  @Cron('0 0 1 1 *')
  async resetAnnualCaps(): Promise<void> {
    this.logger.info('Running cron: resetAnnualCaps');
    const previousYear = new Date().getFullYear() - 1;
    const newYear = previousYear + 1;

    const previousCaps = await this.capRepo.find({ where: { year: previousYear } });

    for (const prev of previousCaps) {
      const existing = await this.capRepo.findOne({
        where: { userId: prev.userId, year: newYear },
      });
      if (!existing) {
        await this.capRepo.save(
          this.capRepo.create({ userId: prev.userId, year: newYear, totalInvested: 0 }),
        );
      } else {
        await this.capRepo.update(existing.id, { totalInvested: 0 });
      }
    }

    this.logger.info({ count: previousCaps.length, year: newYear }, 'Annual caps reset');
  }
}
