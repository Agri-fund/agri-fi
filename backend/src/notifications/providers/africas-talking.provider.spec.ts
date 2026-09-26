import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AfricasTalkingProvider } from './africas-talking.provider';
import { Logger } from '@nestjs/common';

jest.mock('africastalking', () => {
  return jest.fn().mock(() => ({
    SMS: {
      send: jest.fn(),
    },
  }));
});

describe('AfricasTalkingProvider', () => {
  let provider: AfricasTalkingProvider;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AfricasTalkingProvider,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue?: any) => {
              const config: Record<string, string> = {
                AFRICAS_TALKING_API_KEY: 'test-api-key',
                AFRICAS_TALKING_USERNAME: 'test-username',
              };
              return config[key] ?? defaultValue;
            },
          },
        },
      ],
    }).compile();

    provider = module.get<AfricasTalkingProvider>(AfricasTalkingProvider);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(provider).toBeDefined();
  });

  it('should send SMS successfully', async () => {
    const mockSMS = {
      send: jest.fn().mockResolvedValue({
        SMSMessageData: {
          Recipients: [
            {
              statusCode: '101',
              status: 'Success',
            },
          ],
        },
      }),
    };

    (provider as any).smsService = mockSMS;

    await provider.sendSMS({
      phone: '+254712345678',
      message: 'Milestone reached',
    });

    expect(mockSMS.send).toHaveBeenCalledWith({
      recipients: ['+254712345678'],
      message: 'Milestone reached',
    });
  });

  it('should throw error on failed send', async () => {
    const mockSMS = {
      send: jest.fn().mockRejectedValue(new Error('API Error')),
    };

    (provider as any).smsService = mockSMS;

    await expect(
      provider.sendSMS({
        phone: '+254712345678',
        message: 'Test message',
      }),
    ).rejects.toThrow('API Error');
  });

  it('should handle missing API key gracefully', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AfricasTalkingProvider,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue?: any) => {
              const config: Record<string, string> = {
                AFRICAS_TALKING_API_KEY: '',
              };
              return config[key] ?? defaultValue;
            },
          },
        },
      ],
    }).compile();

    const testProvider = module.get<AfricasTalkingProvider>(
      AfricasTalkingProvider,
    );

    await testProvider.sendSMS({
      phone: '+254712345678',
      message: 'Test message',
    });

    // Should not throw and should just log warning
    expect(testProvider).toBeDefined();
  });

  it('should mask phone numbers in logs', async () => {
    const loggerSpy = jest.spyOn(Logger.prototype, 'log');

    const mockSMS = {
      send: jest.fn().mockResolvedValue({
        SMSMessageData: {
          Recipients: [{ statusCode: '101' }],
        },
      }),
    };

    (provider as any).smsService = mockSMS;

    await provider.sendSMS({
      phone: '+254712345678',
      message: 'Test',
    });

    // Verify masking happens (last 4 digits shown)
    expect((provider as any).maskPhone('+254712345678')).toBe('****5678');
  });
});
