import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sgMail from '@sendgrid/mail';

@Injectable()
export class SendGridProvider {
  private readonly logger = new Logger(SendGridProvider.name);
  private readonly apiKey: string;
  private readonly sandboxMode: boolean;

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get<string>('SENDGRID_API_KEY', '');
    this.sandboxMode =
      this.config.get<string>('SENDGRID_SANDBOX_MODE', 'false') === 'true';

    if (!this.apiKey) {
      this.logger.warn(
        'SENDGRID_API_KEY not configured. Email sending will be disabled.',
      );
    } else {
      sgMail.setApiKey(this.apiKey);
    }
  }

  async sendEmail(options: {
    to: string;
    subject: string;
    text?: string;
    html?: string;
    from?: string;
  }): Promise<void> {
    if (!this.apiKey) {
      this.logger.warn(
        'Email sending skipped: SENDGRID_API_KEY not configured.',
      );
      return;
    }

    const fromEmail =
      options.from || this.config.get<string>('SENDGRID_FROM_EMAIL', '');

    if (!fromEmail) {
      this.logger.error('SENDGRID_FROM_EMAIL not configured.');
      throw new Error('From email address is required');
    }

    try {
      const msg = {
        to: options.to,
        from: fromEmail,
        subject: options.subject,
        text: options.text,
        html: options.html,
        mailSettings: {
          sandboxMode: {
            enable: this.sandboxMode,
          },
        },
      };

      await sgMail.send(msg);
      this.logger.log(`Email sent successfully to ${options.to}`);
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${options.to}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
