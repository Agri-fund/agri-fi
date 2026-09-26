import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { NotificationsService } from './notifications.service';
import { NotificationEntity } from './entities/notification.entity';
import { FakeSmsProvider } from './providers/fake-sms.provider';
import { SmsRateLimiterService } from './sms-rate-limiter.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { SMS_PROVIDER_TOKEN } from './providers/sms.provider';

describe('NotificationsService - SMS', () => {
  let service: NotificationsService;
  let configService: ConfigService;
  let notificationRepo: Repository<NotificationEntity>;
  let smsProvider: FakeSmsProvider;
  let smsRateLimiter: SmsRateLimiterService;
  let preferencesService: NotificationPreferencesService;
  let logger: PinoLogger;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue?: any) => {
              const config: Record<string, string> = {
                NOTIFICATIONS_ENABLED: 'true',
                NOTIFICATIONS_SMS_ENABLED: 'true',
                SMS_DAILY_CAP_PER_USER: '10',
                SMTP_HOST: 'localhost',
                SMTP_PORT: '1025',
                SMTP_USER: '',
                SMTP_PASS: '',
              };
              return config[key] ?? defaultValue;
            },
          },
        },
        {
          provide: getRepositoryToken(NotificationEntity),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            count: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: PinoLogger,
          useValue: {
            setContext: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
            log: jest.fn(),
          },
        },
        {
          provide: SMS_PROVIDER_TOKEN,
          useClass: FakeSmsProvider,
        },
        SmsRateLimiterService,
        NotificationPreferencesService,
        {
          provide: 'getRepositoryToken(NotificationPreference)',
          useValue: {
            findOne: jest.fn().mockResolvedValue(null),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    configService = module.get<ConfigService>(ConfigService);
    notificationRepo = module.get<Repository<NotificationEntity>>(
      getRepositoryToken(NotificationEntity),
    );
    smsProvider = module.get<FakeSmsProvider>(SMS_PROVIDER_TOKEN);
    smsRateLimiter = module.get<SmsRateLimiterService>(SmsRateLimiterService);
    preferencesService = module.get<NotificationPreferencesService>(
      NotificationPreferencesService,
    );
    logger = module.get<PinoLogger>(PinoLogger);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendSMS', () => {
    it('should send SMS when enabled and within rate limit', async () => {
      const userId = 'user-1';
      const phone = '+254712345678';
      const message = 'Milestone reached: 50% funding complete';

      jest.spyOn(smsRateLimiter, 'isWithinDailyLimit').mockResolvedValue(true);
      jest
        .spyOn(preferencesService, 'isChannelEnabled')
        .mockResolvedValue(true);

      await service.sendSMS(userId, phone, message, {
        notificationType: 'deal_update',
      });

      const sentMessages = smsProvider.getSentMessages();
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].phone).toBe(phone);
      expect(sentMessages[0].message).toBe(message);
    });

    it('should not send SMS when daily cap is reached', async () => {
      const userId = 'user-1';
      const phone = '+254712345678';
      const message = 'Test message';

      jest.spyOn(smsRateLimiter, 'isWithinDailyLimit').mockResolvedValue(false);

      await service.sendSMS(userId, phone, message);

      const sentMessages = smsProvider.getSentMessages();
      expect(sentMessages).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should not send SMS when channel is disabled in preferences', async () => {
      const userId = 'user-1';
      const phone = '+254712345678';
      const message = 'Test message';

      jest.spyOn(smsRateLimiter, 'isWithinDailyLimit').mockResolvedValue(true);
      jest
        .spyOn(preferencesService, 'isChannelEnabled')
        .mockResolvedValue(false);

      await service.sendSMS(userId, phone, message, {
        notificationType: 'deal_update',
      });

      const sentMessages = smsProvider.getSentMessages();
      expect(sentMessages).toHaveLength(0);
      expect(logger.debug).toHaveBeenCalled();
    });

    it('should log in test mode when SMS is disabled', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          NotificationsService,
          {
            provide: ConfigService,
            useValue: {
              get: (key: string, defaultValue?: any) => {
                const config: Record<string, string> = {
                  NOTIFICATIONS_ENABLED: 'true',
                  NOTIFICATIONS_SMS_ENABLED: 'false',
                  SMTP_HOST: 'localhost',
                  SMTP_PORT: '1025',
                  SMTP_USER: '',
                  SMTP_PASS: '',
                };
                return config[key] ?? defaultValue;
              },
            },
          },
          {
            provide: getRepositoryToken(NotificationEntity),
            useValue: {
              create: jest.fn(),
              save: jest.fn(),
            },
          },
          {
            provide: PinoLogger,
            useValue: {
              setContext: jest.fn(),
              info: jest.fn(),
            },
          },
          {
            provide: SMS_PROVIDER_TOKEN,
            useValue: null,
          },
        ],
      }).compile();

      const testService = module.get<NotificationsService>(NotificationsService);
      const testLogger = module.get<PinoLogger>(PinoLogger);

      await testService.sendSMS('user-1', '+254712345678', 'Test message');

      expect(testLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: '****5678',
          userId: 'user-1',
        }),
        expect.stringContaining('[Test Mode]'),
      );
    });

    it('should mask phone numbers in logs', async () => {
      const userId = 'user-1';
      const phone = '+254712345678';
      const message = 'Test message';

      jest.spyOn(smsRateLimiter, 'isWithinDailyLimit').mockResolvedValue(true);
      jest
        .spyOn(preferencesService, 'isChannelEnabled')
        .mockResolvedValue(true);

      await service.sendSMS(userId, phone, message);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: '****5678',
        }),
        expect.any(String),
      );
    });

    it('should handle multiple SMS sends within daily cap', async () => {
      const userId = 'user-1';
      const phone = '+254712345678';

      jest.spyOn(smsRateLimiter, 'isWithinDailyLimit').mockResolvedValue(true);
      jest
        .spyOn(preferencesService, 'isChannelEnabled')
        .mockResolvedValue(true);

      await service.sendSMS(userId, phone, 'Milestone 1 reached');
      await service.sendSMS(userId, phone, 'Milestone 2 reached');
      await service.sendSMS(userId, phone, 'Escrow settled');

      const sentMessages = smsProvider.getSentMessages();
      expect(sentMessages).toHaveLength(3);
      expect(sentMessages[0].message).toBe('Milestone 1 reached');
      expect(sentMessages[1].message).toBe('Milestone 2 reached');
      expect(sentMessages[2].message).toBe('Escrow settled');
    });

    it('should include metadata in SMS send', async () => {
      const userId = 'user-1';
      const phone = '+254712345678';
      const message = 'Milestone reached';
      const metadata = {
        notificationType: 'deal_update',
        dealId: 'deal-123',
        eventType: 'milestone',
      };

      jest.spyOn(smsRateLimiter, 'isWithinDailyLimit').mockResolvedValue(true);
      jest
        .spyOn(preferencesService, 'isChannelEnabled')
        .mockResolvedValue(true);

      await service.sendSMS(userId, phone, message, metadata);

      const sentMessages = smsProvider.getSentMessages();
      expect(sentMessages[0].metadata).toEqual(metadata);
    });
  });

  describe('SMS Rate Limiting', () => {
    it('should track daily SMS count', async () => {
      const userId = 'user-1';

      // Mock count to return 5 existing SMSs today
      jest.spyOn(notificationRepo, 'count').mockResolvedValue(5);

      const isWithinLimit = await smsRateLimiter.isWithinDailyLimit(userId);
      expect(isWithinLimit).toBe(true);
    });

    it('should reject SMS when daily cap reached', async () => {
      const userId = 'user-1';

      // Mock count to return 10 SMSs (at daily cap of 10)
      jest.spyOn(notificationRepo, 'count').mockResolvedValue(10);

      const isWithinLimit = await smsRateLimiter.isWithinDailyLimit(userId);
      expect(isWithinLimit).toBe(false);
    });

    it('should return configured daily cap', () => {
      const cap = smsRateLimiter.getDailySmsCap();
      expect(cap).toBe(10);
    });
  });

  describe('Fake Provider', () => {
    it('should capture sent messages for testing', async () => {
      await smsProvider.sendSMS({
        phone: '+254712345678',
        message: 'Test message 1',
      });
      await smsProvider.sendSMS({
        phone: '+254712345679',
        message: 'Test message 2',
      });

      const messages = smsProvider.getSentMessages();
      expect(messages).toHaveLength(2);
      expect(messages[0].phone).toBe('+254712345678');
      expect(messages[1].phone).toBe('+254712345679');
    });

    it('should clear sent messages', async () => {
      await smsProvider.sendSMS({
        phone: '+254712345678',
        message: 'Test message',
      });

      let messages = smsProvider.getSentMessages();
      expect(messages).toHaveLength(1);

      smsProvider.clearSentMessages();
      messages = smsProvider.getSentMessages();
      expect(messages).toHaveLength(0);
    });
  });
});
