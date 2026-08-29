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

@Injectable()
export class NotificationsService {
  private transporter: nodemailer.Transporter | null = null;
  private isEnabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
    @InjectRepository(NotificationEntity)
    private readonly notificationRepo: Repository<NotificationEntity>,
  ) {
    (this.logger as any).setContext(NotificationsService.name);

    this.isEnabled =
      this.configService.get<string>('NOTIFICATIONS_ENABLED') !== 'false';

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
}
