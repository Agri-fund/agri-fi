export interface SmsProvider {
  sendSMS(options: {
    phone: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export const SMS_PROVIDER_TOKEN = 'SMS_PROVIDER';
