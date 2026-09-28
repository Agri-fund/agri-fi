import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TwilioProvider } from './twilio.provider';
import { Logger } from '@nestjs/common';

jest.mock('twilio', () => {
  return jest.fn().mockReturnValue({
    messages: {
      create: jest.fn(),
    },
  });
});

describe('TwilioProvider', () => {
  let provider: TwilioProvider;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwilioProvider,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue?: any) => {
              const config: Record<string, string> = {
                TWILIO_ACCOUNT_SID: 'test-sid',
                TWILIO_AUTH_TOKEN: 'test-token',
                TWILIO_PHONE_NUMBER: '+1234567890',
              };
              return config[key] ?? defaultValue;
            },
          },
        },
      ],
    }).compile();

    provider = module.get<TwilioProvider>(TwilioProvider);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  it('should send SMS successfully', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      sid: 'SM123456789',
      status: 'queued',
    });

    (provider as any).client = {
      messages: {
        create: mockCreate,
      },
    };

    await provider.sendSMS({
      phone: '+254712345678',
      message: 'Milestone reached',
    });

    expect(mockCreate).toHaveBeenCalledWith({
      body: 'Milestone reached',
      from: '+1234567890',
      to: '+254712345678',
    });
  });

  it('should throw error on failed send', async () => {
    const mockCreate = jest.fn().mockRejectedValue(new Error('Twilio API Error'));

    (provider as any).client = {
      messages: {
        create: mockCreate,
      },
    };

    await expect(
      provider.sendSMS({
        phone: '+254712345678',
        message: 'Test message',
      }),
    ).rejects.toThrow('Twilio API Error');
  });

  it('should handle missing credentials gracefully', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwilioProvider,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue?: any) => {
              const config: Record<string, string> = {
                TWILIO_ACCOUNT_SID: '',
                TWILIO_AUTH_TOKEN: '',
                TWILIO_PHONE_NUMBER: '',
              };
              return config[key] ?? defaultValue;
            },
          },
        },
      ],
    }).compile();

    const testProvider = module.get<TwilioProvider>(TwilioProvider);

    await testProvider.sendSMS({
      phone: '+254712345678',
      message: 'Test message',
    });

    // Should not throw and should just log warning
    expect(testProvider).toBeDefined();
  });

  it('should mask phone numbers in logs', () => {
    expect((provider as any).maskPhone('+254712345678')).toBe('****5678');
    expect((provider as any).maskPhone('1234')).toBe('****4');
    expect((provider as any).maskPhone('')).toBe('***');
  });
});
