import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ArchivalService } from './archival.service';

@Injectable()
export class ArchivalCronService {
  private readonly logger = new Logger(ArchivalCronService.name);

  constructor(private readonly archivalService: ArchivalService) {}

  /**
   * Weekly archival cron job running Sunday 02:00 UTC (0 2 * * 0).
   */
  @Cron('0 2 * * 0', { timeZone: 'UTC' })
  async handleWeeklyArchival(): Promise<void> {
    this.logger.log('Starting scheduled weekly archival job (Sunday 02:00 UTC)...');
    try {
      const archiveResult = await this.archivalService.copyToArchive(2);
      this.logger.log(`Archival completed: ${JSON.stringify(archiveResult)}`);

      const validation = await this.archivalService.validateArchive(2);
      this.logger.log(`Validation completed: ${JSON.stringify(validation)}`);

      if (validation.valid) {
        const hardDeletedCount = await this.archivalService.hardDeleteValidatedArchives(30);
        this.logger.log(`Hard delete completed: ${hardDeletedCount} records purged.`);
      } else {
        this.logger.warn('Archive validation failed during cron execution. Skipping hard delete.');
      }
    } catch (err) {
      this.logger.error(`Error during weekly archival cron job: ${(err as Error).message}`, (err as Error).stack);
    }
  }
}
