import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { KycSubmission } from './entities/kyc-submission.entity';
import { User } from './entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';

/** Reminder windows in days before document expiry. #787 */
export const KYC_REMINDER_DAYS = [30, 14, 7] as const;
type ReminderDay = (typeof KYC_REMINDER_DAYS)[number];

/** Maps reminder days to the DB field that tracks whether the alert was sent. */
const ALERT_FIELD_MAP: Record<ReminderDay, keyof KycSubmission> = {
  30: 'alert30SentAt',
  14: 'alert15SentAt', // reusing the existing column (was "15d", now 14d per spec)
  7: 'alert3SentAt', // reusing the existing column (was "3d", now 7d per spec)
};

@Injectable()
export class KycCronService {
  constructor(
    @InjectRepository(KycSubmission)
    private readonly kycSubmissionRepo: Repository<KycSubmission>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(KycCronService.name);
  }

  /**
   * Runs once daily at midnight.
   * For every approved KYC submission with a documentExpiresAt date:
   *  - Sends a reminder email at 30, 14, and 7 days before expiry (#787).
   *  - Marks expired documents and updates the user's kycStatus.
   * Each reminder is logged to the system audit log.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async checkKycExpirations(): Promise<void> {
    this.logger.info('KYC expiration cron job started');
    const now = new Date();

    const submissions = await this.kycSubmissionRepo.find({
      where: { status: 'approved' },
      relations: ['user'],
    });

    let remindedCount = 0;
    let expiredCount = 0;

    for (const submission of submissions) {
      if (!submission.documentExpiresAt) continue;

      const expiresAt = new Date(submission.documentExpiresAt);
      const msUntilExpiry = expiresAt.getTime() - now.getTime();
      const daysUntilExpiry = Math.ceil(msUntilExpiry / (1000 * 60 * 60 * 24));

      if (daysUntilExpiry <= 0) {
        await this.handleExpiration(submission);
        expiredCount++;
        continue;
      }

      for (const days of KYC_REMINDER_DAYS) {
        const alertField = ALERT_FIELD_MAP[days];
        const alreadySent = submission[alertField];
        // Trigger when we are within the window for this milestone and it hasn't been sent yet
        if (daysUntilExpiry <= days && !alreadySent) {
          await this.sendReminder(submission, days);
          remindedCount++;
          break; // Only one reminder per run per submission (most urgent unsent)
        }
      }
    }

    this.logger.info(
      { remindedCount, expiredCount, totalChecked: submissions.length },
      'KYC expiration cron job completed',
    );
  }

  /**
   * Sends a reminder email to the user and logs the event to the audit log.
   * Updates the alert-sent timestamp on the submission record.
   */
  private async sendReminder(
    submission: KycSubmission,
    daysRemaining: ReminderDay,
  ): Promise<void> {
    const user = submission.user;
    if (!user) {
      this.logger.warn(
        { submissionId: submission.id },
        'KYC submission has no associated user; skipping reminder',
      );
      return;
    }

    const resubmissionUrl = this.buildResubmissionUrl(user.id);
    const subject = `Action required: Your KYC document expires in ${daysRemaining} days`;
    const text =
      `Hello,\n\n` +
      `Your KYC document on Agri-Fi is due to expire in ${daysRemaining} day(s).\n\n` +
      `Please resubmit your updated documents to avoid interruption to your account:\n` +
      `${resubmissionUrl}\n\n` +
      `If you have already resubmitted, you may ignore this message.\n\n` +
      `The Agri-Fi Compliance Team`;

    const html =
      `<p>Hello,</p>` +
      `<p>Your KYC document on <strong>Agri-Fi</strong> is due to expire in <strong>${daysRemaining} day(s)</strong>.</p>` +
      `<p>Please <a href="${resubmissionUrl}">resubmit your updated documents</a> to avoid interruption to your account.</p>` +
      `<p>If you have already resubmitted, you may ignore this message.</p>` +
      `<p>The Agri-Fi Compliance Team</p>`;

    try {
      await this.notificationsService.sendEmail(
        user.email,
        subject,
        text,
        html,
      );

      // Persist in-app notification as well
      await this.notificationsService.createNotification({
        userId: user.id,
        type: 'kyc',
        title: `KYC document expires in ${daysRemaining} days`,
        message: `Your KYC document will expire in ${daysRemaining} day(s). Please resubmit to stay compliant.`,
        linkUrl: resubmissionUrl,
        metadataJson: {
          submissionId: submission.id,
          daysRemaining,
          documentExpiresAt: submission.documentExpiresAt,
        },
      });

      // Mark the alert as sent
      const alertField = ALERT_FIELD_MAP[daysRemaining];
      await this.kycSubmissionRepo.update(submission.id, {
        [alertField]: new Date(),
      });

      // Log to audit trail
      await this.auditService.logEvent({
        actorId: user.id,
        actorRole: user.role,
        route: 'kyc-cron/reminder',
        statusCode: 200,
        requestDetails: {
          event: 'kyc_expiry_reminder_sent',
          submissionId: submission.id,
          userId: user.id,
          daysRemaining,
          documentExpiresAt: submission.documentExpiresAt,
          alertField,
        },
      });

      this.logger.info(
        { submissionId: submission.id, userId: user.id, daysRemaining },
        `KYC expiry reminder sent (${daysRemaining}d)`,
      );
    } catch (error: any) {
      this.logger.error(
        {
          submissionId: submission.id,
          userId: user.id,
          daysRemaining,
          error: error.message,
        },
        `Failed to send KYC expiry reminder (${daysRemaining}d)`,
      );
    }
  }

  /**
   * Marks the submission as expired, updates the user's kycStatus, and
   * sends an expiry notification email.
   */
  private async handleExpiration(submission: KycSubmission): Promise<void> {
    const user = submission.user;
    if (!user) return;

    try {
      await this.kycSubmissionRepo.update(submission.id, { status: 'expired' });
      await this.userRepo.update(user.id, { kycStatus: 'expired' });

      const resubmissionUrl = this.buildResubmissionUrl(user.id);
      const subject = 'Your KYC document has expired — action required';
      const text =
        `Hello,\n\n` +
        `Your KYC document on Agri-Fi has expired. Your account access has been restricted.\n\n` +
        `Please resubmit your documents immediately:\n` +
        `${resubmissionUrl}\n\n` +
        `The Agri-Fi Compliance Team`;

      const html =
        `<p>Hello,</p>` +
        `<p>Your KYC document on <strong>Agri-Fi</strong> has <strong>expired</strong>. Your account access has been restricted.</p>` +
        `<p>Please <a href="${resubmissionUrl}">resubmit your documents immediately</a>.</p>` +
        `<p>The Agri-Fi Compliance Team</p>`;

      await this.notificationsService.sendEmail(
        user.email,
        subject,
        text,
        html,
      );

      await this.notificationsService.createNotification({
        userId: user.id,
        type: 'kyc',
        title: 'KYC document expired',
        message:
          'Your KYC document has expired. Please resubmit to restore access.',
        linkUrl: resubmissionUrl,
        metadataJson: {
          submissionId: submission.id,
          documentExpiresAt: submission.documentExpiresAt,
          event: 'kyc_expired',
        },
      });

      // Audit log
      await this.auditService.logEvent({
        actorId: user.id,
        actorRole: user.role,
        route: 'kyc-cron/expired',
        statusCode: 200,
        requestDetails: {
          event: 'kyc_document_expired',
          submissionId: submission.id,
          userId: user.id,
          documentExpiresAt: submission.documentExpiresAt,
        },
      });

      this.logger.info(
        { submissionId: submission.id, userId: user.id },
        'KYC submission expired; user kycStatus updated and notification sent',
      );
    } catch (error: any) {
      this.logger.error(
        { submissionId: submission.id, userId: user?.id, error: error.message },
        'Failed to handle KYC expiration',
      );
    }
  }

  /**
   * Builds the frontend URL for the KYC resubmission page.
   */
  private buildResubmissionUrl(userId: string): string {
    const base = this.configService.get<string>(
      'FRONTEND_URL',
      'https://app.agri-fi.com',
    );
    return `${base}/kyc/resubmit?userId=${userId}`;
  }
}
