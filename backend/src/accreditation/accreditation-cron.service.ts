import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import { AccreditationService } from './accreditation.service';
import { AnnualCapService } from './annual-cap.service';

@Injectable()
export class AccreditationCronService {
  constructor(
    private readonly accreditationService: AccreditationService,
    private readonly annualCapService: AnnualCapService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AccreditationCronService.name);
  }

  /**
   * Runs at 00:05 on January 1st every year.
   * Resets all investors' annual investment totals to zero for the new year (#902).
   */
  @Cron('5 0 1 1 *')
  async resetAnnualInvestmentTotals(): Promise<void> {
    const newYear = new Date().getFullYear();
    this.logger.info({ newYear }, 'Resetting annual investment totals');
    try {
      await this.annualCapService.resetAnnualTotals(newYear);
      this.logger.info({ newYear }, 'Annual investment totals reset successfully');
    } catch (err) {
      this.logger.error({ err, newYear }, 'Failed to reset annual investment totals');
    }
  }

  /**
   * Runs every day at midnight.
   * Checks for accreditations that have passed their 2-year TTL and expires them (#902).
   * Expired users are downgraded back to 'retail' tier and must re-apply.
   */
  @Cron('0 0 * * *')
  async expireStaleAccreditations(): Promise<void> {
    this.logger.info('Running accreditation expiry check');
    try {
      const expiredCount =
        await this.accreditationService.expireStaleAccreditations();
      if (expiredCount > 0) {
        this.logger.info(
          { expiredCount },
          'Expired accreditations downgraded to retail',
        );
      }
    } catch (err) {
      this.logger.error({ err }, 'Accreditation expiry check failed');
    }
  }
}
