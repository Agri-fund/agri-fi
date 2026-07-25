import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { KycSubmission } from './entities/kyc-submission.entity';
import { User } from './entities/user.entity';
import { QueueService } from '../queue/queue.service';

@Injectable()
export class KycCronService {
  constructor(
    @InjectRepository(KycSubmission)
    private readonly kycSubmissionRepo: Repository<KycSubmission>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly queueService: QueueService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(KycCronService.name);
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async checkKycExpirations(): Promise<void> {
    this.logger.info('Running cron job: check KYC expirations');
    const now = new Date();

    // Get all approved KYC submissions with documentExpiresAt
    const submissions = await this.kycSubmissionRepo.find({
      where: { status: 'approved' },
      relations: ['user'],
    });

    for (const submission of submissions) {
      if (!submission.documentExpiresAt) continue;

      const expiresAt = new Date(submission.documentExpiresAt);
      const daysUntilExpiry = Math.ceil(
        (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Check for expiration
      if (daysUntilExpiry <= 0 && submission.status !== 'expired') {
        await this.handleExpiration(submission);
        continue;
      }

      // Check for 30 day alert
      if (daysUntilExpiry === 30 && !submission.alert30SentAt) {
        await this.sendAlert(submission, 'kyc_expiration_30', 'alert30SentAt');
        continue;
      }

      // Check for 15 day alert
      if (daysUntilExpiry === 15 && !submission.alert15SentAt) {
        await this.sendAlert(submission, 'kyc_expiration_15', 'alert15SentAt');
        continue;
      }

      // Check for 3 day alert
      if (daysUntilExpiry === 3 && !submission.alert3SentAt) {
        await this.sendAlert(submission, 'kyc_expiration_3', 'alert3SentAt');
        continue;
      }
    }

    this.logger.info('KYC expiration check completed');
  }

  private async sendAlert(
    submission: KycSubmission,
    alertType: string,
    alertField: keyof KycSubmission
  ): Promise<void> {
    try {
      await this.queueService.emit('email.notification', {
        type: alertType,
        userId: submission.userId,
      });
      
      await this.kycSubmissionRepo.update(submission.id, {
        [alertField]: new Date(),
      });
      
      this.logger.info(
        { submissionId: submission.id, alertType },
        `Successfully sent ${alertType} alert`
      );
    } catch (error) {
      this.logger.error(
        { submissionId: submission.id, alertType, error: error.message },
        `Failed to send ${alertType} alert`
      );
    }
  }

  private async handleExpiration(submission: KycSubmission): Promise<void> {
    try {
      // Update KYC submission status to expired
      await this.kycSubmissionRepo.update(submission.id, {
        status: 'expired',
      });

      // Update user KYC status to expired
      await this.userRepo.update(submission.userId, {
        kycStatus: 'expired',
      });

      // Send expiration email
      await this.queueService.emit('email.notification', {
        type: 'kyc_expired',
        userId: submission.userId,
      });

      this.logger.info(
        { submissionId: submission.id, userId: submission.userId },
        'Successfully expired KYC submission'
      );
    } catch (error) {
      this.logger.error(
        { submissionId: submission.id, error: error.message },
        'Failed to expire KYC submission'
      );
    }
  }
}
