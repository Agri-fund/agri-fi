import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuthService } from './auth.service';

@Injectable()
export class EmailChangeCleanupService {
  private readonly logger = new Logger(EmailChangeCleanupService.name);

  constructor(private readonly authService: AuthService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleCleanupExpiredEmailChanges(): Promise<void> {
    try {
      const cleared = await this.authService.cleanupExpiredEmailChanges();
      if (cleared > 0) {
        this.logger.log(
          `Cleared ${cleared} expired email change request(s)`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Failed to clean up expired email changes',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}