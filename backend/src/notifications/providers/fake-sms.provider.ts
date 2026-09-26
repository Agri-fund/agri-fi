import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms.provider';

@Injectable()
export class FakeSmsProvider implements SmsProvider {
  private readonly logger = new Logger(FakeSmsProvider.name);
  private readonly sentMessages: Array<{
    phone: string;
    message: string;
    timestamp: Date;
    metadata?: Record<string, unknown>;
  }> = [];

  async sendSMS(options: {
    phone: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    this.sentMessages.push({
      phone: options.phone,
      message: options.message,
      timestamp: new Date(),
      metadata: options.metadata,
    });
    this.logger.log(
      `[TEST MODE] SMS sent to ${this.maskPhone(options.phone)}: "${options.message.substring(0, 50)}..."`,
    );
  }

  getSentMessages(): Array<{
    phone: string;
    message: string;
    timestamp: Date;
    metadata?: Record<string, unknown>;
  }> {
    return this.sentMessages;
  }

  clearSentMessages(): void {
    this.sentMessages.length = 0;
  }

  private maskPhone(phone: string): string {
    if (!phone || phone.length < 4) return '***';
    return `***${phone.slice(-4)}`;
  }
}
