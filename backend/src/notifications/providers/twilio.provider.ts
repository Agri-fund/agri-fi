import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsProvider } from './sms.provider';
import * as twilio from 'twilio';

@Injectable()
export class TwilioProvider implements SmsProvider {
  private readonly logger = new Logger(TwilioProvider.name);
  private readonly client: twilio.Twilio | null;
  private readonly fromNumber: string;

  constructor(private readonly config: ConfigService) {
    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID', '');
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN', '');
    this.fromNumber = this.config.get<string>('TWILIO_PHONE_NUMBER', '');

    if (!accountSid || !authToken || !this.fromNumber) {
      this.logger.warn(
        'Twilio credentials not configured. SMS sending will be disabled.',
      );
      this.client = null;
    } else {
      this.client = twilio(accountSid, authToken);
    }
  }

  async sendSMS(options: {
    phone: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.client) {
      this.logger.warn(
        `SMS sending skipped: Twilio credentials not configured. Phone: ${this.maskPhone(options.phone)}`,
      );
      return;
    }

    try {
      await this.client.messages.create({
        body: options.message,
        from: this.fromNumber,
        to: options.phone,
      });

      this.logger.log(
        `SMS sent successfully to ${this.maskPhone(options.phone)}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send SMS to ${this.maskPhone(options.phone)}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private maskPhone(phone: string): string {
    if (!phone || phone.length < 4) return '***';
    return `***${phone.slice(-4)}`;
  }
}
