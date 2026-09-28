import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsProvider } from './sms.provider';
import * as AfricasTalking from 'africastalking';

@Injectable()
export class AfricasTalkingProvider implements SmsProvider {
  private readonly logger = new Logger(AfricasTalkingProvider.name);
  private readonly client: any;
  private readonly smsService: any;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('AFRICAS_TALKING_API_KEY', '');
    const username = this.config.get<string>(
      'AFRICAS_TALKING_USERNAME',
      'sandbox',
    );

    if (!apiKey) {
      this.logger.warn(
        'AfricasTalking API key not configured. SMS sending will be disabled.',
      );
      this.client = null;
      this.smsService = null;
    } else {
      const africasTalking = AfricasTalking({ apiKey, username });
      this.smsService = africasTalking.SMS;
    }
  }

  async sendSMS(options: {
    phone: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.smsService) {
      this.logger.warn(
        `SMS sending skipped: AfricasTalking API key not configured. Phone: ${this.maskPhone(options.phone)}`,
      );
      return;
    }

    try {
      const result = await this.smsService.send({
        recipients: [options.phone],
        message: options.message,
      });

      if (result.SMSMessageData?.Recipients?.[0]?.statusCode === '101') {
        this.logger.log(
          `SMS sent successfully to ${this.maskPhone(options.phone)}`,
        );
      } else {
        const errorMsg =
          result.SMSMessageData?.Recipients?.[0]?.status ||
          'Unknown error from AfricasTalking';
        this.logger.error(
          `Failed to send SMS to ${this.maskPhone(options.phone)}: ${errorMsg}`,
        );
        throw new Error(errorMsg);
      }
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
