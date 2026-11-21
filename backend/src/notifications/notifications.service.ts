import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import * as nodemailer from 'nodemailer';
import {
  NotificationEntity,
  NotificationType,
} from './entities/notification.entity';
import { WatchlistActivityType } from '../watchlist/entities/watchlist.entity';

import { Optional, Inject } from '@nestjs/common';
import {
  PushNotificationService,
  PushPayload,
} from './push-notification.service';
import { SmsProvider, SMS_PROVIDER_TOKEN } from './providers/sms.provider';
import { SmsRateLimiterService } from './sms-rate-limiter.service';
import { NotificationPreferencesService } from './notification-preferences.service';

@Injectable()
export class NotificationsService {
  private transporter: nodemailer.Transporter | null = null;
  private isEnabled: boolean;
  private smsEnabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
    @InjectRepository(NotificationEntity)
    private readonly notificationRepo: Repository<NotificationEntity>,
    @Optional()
    private readonly pushNotificationService?: PushNotificationService,
    @Optional()
    @Inject(SMS_PROVIDER_TOKEN)
    private readonly smsProvider?: SmsProvider,
    @Optional()
    private readonly smsRateLimiter?: SmsRateLimiterService,
    @Optional()
    private readonly notificationPreferencesService?: NotificationPreferencesService,
  ) {
    (this.logger as any).setContext(NotificationsService.name);

    this.isEnabled =
      this.configService.get<string>('NOTIFICATIONS_ENABLED') !== 'false';

    this.smsEnabled =
      this.configService.get<string>('NOTIFICATIONS_SMS_ENABLED') !== 'false';

    if (this.isEnabled) {
      this.transporter = nodemailer.createTransport({
        host: this.configService.get<string>('SMTP_HOST', 'localhost'),
        port: parseInt(this.configService.get<string>('SMTP_PORT', '1025'), 10),
        secure:
          parseInt(this.configService.get<string>('SMTP_PORT', '1025'), 10) ===
          465,
        auth: {
          user: this.configService.get<string>('SMTP_USER', ''),
          pass: this.configService.get<string>('SMTP_PASS', ''),
        },
      });
    } else {
      this.logger.info(
        'Notifications are disabled (NOTIFICATIONS_ENABLED=false). Emails will only be logged.',
      );
    }
  }

  async sendPush(
    userId: string,
    payload: PushPayload,
  ): Promise<{ sent: number; failed: number }> {
    if (!this.pushNotificationService) {
      this.logger.debug(
        `PushNotificationService not available. Skipping push for user ${userId}`,
      );
      return { sent: 0, failed: 0 };
    }
    return this.pushNotificationService.sendPushNotification(userId, payload);
  }

  async createNotification(params: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    linkUrl?: string;
    metadataJson?: Record<string, unknown>;
  }): Promise<NotificationEntity> {
    const notification = this.notificationRepo.create({
      userId: params.userId,
      type: params.type,
      title: params.title,
      message: params.message,
      linkUrl: params.linkUrl ?? null,
      metadataJson: params.metadataJson ?? null,
    });
    return this.notificationRepo.save(notification);
  }

  /**
   * Creates a notification when a portfolio's simulated loss under a stress
   * scenario exceeds the configured loss threshold.
   */
  async createStressTestAlert(params: {
    userId: string;
    portfolioId: string;
    scenarioId: string;
    scenarioName: string;
    lossAmount: number;
    lossPercentage: number;
    thresholdAmount: number;
    currency?: string;
    reportUrl?: string;
    metadataJson?: Record<string, unknown>;
  }): Promise<NotificationEntity> {
    const currency = params.currency ?? 'USD';
    const formattedLoss = `${params.lossAmount.toFixed(2)} ${currency}`;
    const formattedThreshold = `${params.thresholdAmount.toFixed(2)} ${currency}`;
    const formattedPercentage = `${params.lossPercentage.toFixed(2)}%`;

    const title = `Stress test alert: ${params.scenarioName}`;
    const message =
      `Portfolio ${params.portfolioId} simulated a loss of ${formattedLoss} ` +
      `(${formattedPercentage}) under scenario "${params.scenarioName}", ` +
      `exceeding the configured threshold of ${formattedThreshold}.`;

    const linkUrl =
      params.reportUrl ??
      `/stress-tests/reports/${params.scenarioId}?portfolioId=${params.portfolioId}`;

    this.logger.warn(
      {
        userId: params.userId,
        portfolioId: params.portfolioId,
        scenarioId: params.scenarioId,
        lossAmount: params.lossAmount,
        thresholdAmount: params.thresholdAmount,
      },
      `Stress test loss threshold exceeded for portfolio ${params.portfolioId}`,
    );

    return this.createNotification({
      userId: params.userId,
      type: NotificationType.STRESS_TEST_ALERT,
      title,
      message,
      linkUrl,
      metadataJson: {
        portfolioId: params.portfolioId,
        scenarioId: params.scenarioId,
        scenarioName: params.scenarioName,
        lossAmount: params.lossAmount,
        lossPercentage: params.lossPercentage,
        thresholdAmount: params.thresholdAmount,
        currency,
        ...(params.metadataJson ?? {}),
      },
    });
  }

  /**
   * Creates a notification for a change on a deal the user is watching.
   * Used for funding milestones (50%/75%/100%), risk score changes and
   * status changes on bookmarked deals.
   */
  async createWatchlistActivityNotification(params: {
    userId: string;
    tradeDealId: string;
    activityType: WatchlistActivityType;
    title: string;
    message: string;
    metadataJson?: Record<string, unknown>;
  }): Promise<NotificationEntity> {
    const linkUrl = `/deals/${params.tradeDealId}`;

    this.logger.info(
      {
        userId: params.userId,
        tradeDealId: params.tradeDealId,
        activityType: params.activityType,
      },
      `Watchlist activity (${params.activityType}) for deal ${params.tradeDealId}`,
    );

    return this.createNotification({
      userId: params.userId,
      type: NotificationType.WATCHLIST_ACTIVITY,
      title: params.title,
      message: params.message,
      linkUrl,
      metadataJson: {
        tradeDealId: params.tradeDealId,
        activityType: params.activityType,
        ...(params.metadataJson ?? {}),
      },
    });
  }

  /**
   * Returns the number of unread watchlist activity notifications for a user.
   * Powers the watchlist count badge in the navigation.
   */
  async getUnreadWatchlistCount(userId: string): Promise<number> {
    return this.notificationRepo.count({
      where: {
        userId,
        type: NotificationType.WATCHLIST_ACTIVITY,
        notificationReadAt: IsNull(),
      },
    });
  }

  async getUserNotifications(
    userId: string,
    limit = 10,
    unreadOnly = false,
  ): Promise<NotificationEntity[]> {
    const where: any = { userId };
    if (unreadOnly) {
      where.notificationReadAt = IsNull();
    }
    return this.notificationRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationRepo.count({
      where: { userId, notificationReadAt: IsNull() },
    });
  }

  async markAsRead(userId: string, ids?: string[]): Promise<void> {
    const now = new Date();
    if (ids && ids.length > 0) {
      await this.notificationRepo.update(
        { userId, id: In(ids) },
        { notificationReadAt: now },
      );
    } else {
      await this.notificationRepo.update(
        { userId, notificationReadAt: IsNull() },
        { notificationReadAt: now },
      );
    }
  }

  async sendEmail(
    to: string,
    subject: string,
    text: string,
    html?: string,
    options?: { replyTo?: string; headers?: Record<string, string> },
  ): Promise<void> {
    if (!this.isEnabled || !this.transporter) {
      this.logger.info(
        { to: this.redactEmail(to), subject, text },
        `[Test Mode] Simulated sending email: ${subject}`,
      );
      return;
    }

    try {
      const from = this.configService.get<string>(
        'EMAIL_FROM',
        'noreply@agric-onchain.com',
      );
      await this.transporter.sendMail({
        from,
        to,
        subject,
        text,
        html,
        ...(options?.replyTo ? { replyTo: options.replyTo } : {}),
        ...(options?.headers ? { headers: options.headers } : {}),
      });
      this.logger.info(
        { to: this.redactEmail(to), subject },
        `Successfully sent email to ${this.redactEmail(to)}`,
      );
    } catch (error: any) {
      const redactedTo = this.redactEmail(to);
      const sanitisedError = this.sanitiseErrorMessage(error.message);
      this.logger.error(
        { to: redactedTo, subject, error: sanitisedError },
        `Failed to send email to ${redactedTo}: ${sanitisedError}`,
      );
      throw error;
    }
  }

  private redactEmail(email: string): string {
    if (!email) return '***';
    const parts = email.split('@');
    if (parts.length !== 2) return '***';
    return `***@${parts[1]}`;
  }

  private sanitiseErrorMessage(message: string): string {
    if (!message) return '';
    return message
      .replace(
        /AUTH\s+(?:LOGIN|PLAIN|CRAM-MD5|DIGEST-MD5|XOAUTH2)\s+[a-zA-Z0-9+/=]+/gi,
        'AUTH *** [REDACTED]',
      )
      .replace(
        /AUTH\s+(?:LOGIN|PLAIN|CRAM-MD5|DIGEST-MD5|XOAUTH2)/gi,
        'AUTH ***',
      )
      .replace(/[a-zA-Z0-9+/]{20,}=*/g, '***');
  }

  async sendSMS(
    userId: string,
    phone: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.smsEnabled || !this.smsProvider) {
      this.logger.info(
        { phone: this.maskPhone(phone), userId },
        `[Test Mode] Simulated sending SMS: "${message.substring(0, 50)}..."`,
      );
      return;
    }

    // Check daily rate limit
    if (this.smsRateLimiter) {
      const withinLimit = await this.smsRateLimiter.isWithinDailyLimit(userId);
      if (!withinLimit) {
        this.logger.warn(
          { phone: this.maskPhone(phone), userId },
          `SMS daily cap reached for user ${userId}`,
        );
        return;
      }
    }

    // Check user preference
    const notificationType = metadata?.notificationType as string;
    if (
      this.notificationPreferencesService &&
      notificationType &&
      !(await this.notificationPreferencesService.isChannelEnabled(
        userId,
        notificationType,
        'sms',
      ))
    ) {
      this.logger.debug(
        { phone: this.maskPhone(phone), userId, notificationType },
        `SMS notifications disabled for user ${userId}, type ${notificationType}`,
      );
      return;
    }

    try {
      await this.smsProvider.sendSMS({
        phone,
        message,
        metadata,
      });

      this.logger.info(
        { phone: this.maskPhone(phone), userId },
        `Successfully sent SMS to ${this.maskPhone(phone)}`,
      );
    } catch (error: any) {
      const maskedPhone = this.maskPhone(phone);
      const sanitisedError = this.sanitiseErrorMessage(error.message);
      this.logger.error(
        { phone: maskedPhone, userId, error: sanitisedError },
        `Failed to send SMS to ${maskedPhone}: ${sanitisedError}`,
      );
      throw error;
    }
  }

  private maskPhone(phone: string): string {
    if (!phone || phone.length < 4) return '***';
    return `***${phone.slice(-4)}`;
  }

  /**
   * Send referral credit earned email notification.
   */
  async sendReferralCreditEarnedEmail(
    referrer: any,
    details: {
      amount: number;
      referredUserEmail?: string;
      creditIssuedAt: Date;
    },
  ): Promise<void> {
    const subject = `You earned $${details.amount} referral credit!`;
    const htmlBody = `
      <p>Hi ${referrer.email},</p>
      <p>Great news! Your referral has completed their first investment.</p>
      <p>You've earned <strong>$${details.amount}</strong> in platform credit, which will be applied to your next platform fee.</p>
      ${
        details.referredUserEmail
          ? `<p>Referred user: ${details.referredUserEmail}</p>`
          : ''
      }
      <p>Credit issued: ${details.creditIssuedAt.toISOString()}</p>
      <p>Best regards,<br>Agri-Fi Team</p>
    `;

    await this.sendEmail(referrer.email, subject, htmlBody);
  }
}
