import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import * as nodemailer from 'nodemailer';

@Injectable()
export class NotificationsService {
  private transporter: nodemailer.Transporter | null = null;
  private isEnabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(NotificationsService.name);

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

  async sendEmail(
    to: string,
    subject: string,
    text: string,
    html?: string,
  ): Promise<void> {
    if (!this.isEnabled || !this.transporter) {
      this.logger.info(
        { to, subject, text },
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
      this.logger.info({ to, subject }, `Successfully sent email to ${to}`);
    } catch (error: any) {
      this.logger.error(
        { to, subject, error: error.message },
        `Failed to send email to ${to}: ${error.message}`,
      );
      throw error;
    }
  }
}
