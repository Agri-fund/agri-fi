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
    // Redact SMTP authentication commands and potential tokens
    return message
      .replace(/AUTH\s+(?:LOGIN|PLAIN|CRAM-MD5|DIGEST-MD5|XOAUTH2)\s+[a-zA-Z0-9+/=]+/gi, 'AUTH *** [REDACTED]')
      .replace(/AUTH\s+(?:LOGIN|PLAIN|CRAM-MD5|DIGEST-MD5|XOAUTH2)/gi, 'AUTH ***')
      // Redact potential base64 credentials (long alphanumeric strings that look like tokens)
      .replace(/[a-zA-Z0-9+/]{20,}=*/g, '***');
  }
}
