import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { KycCronService, KYC_REMINDER_DAYS } from './kyc-cron.service';
import { KycSubmission } from './entities/kyc-submission.entity';
import { User } from './entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';

const makeDate = (daysFromNow: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d;
};

const makeUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 'user-1',
    email: 'investor@agri-fi.com',
    role: 'investor',
    kycStatus: 'verified',
    ...overrides,
  } as User);

const makeSubmission = (overrides: Partial<KycSubmission> = {}): KycSubmission =>
  ({
    id: 'sub-1',
    userId: 'user-1',
    status: 'approved',
    documentExpiresAt: makeDate(30),
    alert30SentAt: null,
    alert15SentAt: null,
    alert3SentAt: null,
    user: makeUser(),
    ...overrides,
  } as KycSubmission);

describe('KycCronService', () => {
  let service: KycCronService;

  let kycRepo: jest.Mocked<{
    find: jest.Mock;
    update: jest.Mock;
  }>;
  let userRepo: jest.Mocked<{ update: jest.Mock }>;
  let notificationsService: jest.Mocked<
    Pick<NotificationsService, 'sendEmail' | 'createNotification'>
  >;
  let auditService: jest.Mocked<Pick<AuditService, 'logEvent'>>;
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    kycRepo = { find: jest.fn(), update: jest.fn() };
    userRepo = { update: jest.fn() };
    notificationsService = {
      sendEmail: jest.fn().mockResolvedValue(undefined),
      createNotification: jest.fn().mockResolvedValue({}),
    };
    auditService = { logEvent: jest.fn().mockResolvedValue({}) };
    configService = {
      get: jest.fn((key: string, def?: string) =>
        key === 'FRONTEND_URL' ? 'https://app.agri-fi.com' : def ?? '',
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycCronService,
        { provide: getRepositoryToken(KycSubmission), useValue: kycRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuditService, useValue: auditService },
        { provide: ConfigService, useValue: configService },
        {
          provide: PinoLogger,
          useValue: {
            setContext: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<KycCronService>(KycCronService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('KYC_REMINDER_DAYS constant', () => {
    it('should include 30, 14, and 7 days', () => {
      expect(KYC_REMINDER_DAYS).toEqual(expect.arrayContaining([30, 14, 7]));
    });
  });

  describe('checkKycExpirations', () => {
    it('should do nothing when no submissions exist', async () => {
      kycRepo.find.mockResolvedValue([]);
      await service.checkKycExpirations();
      expect(notificationsService.sendEmail).not.toHaveBeenCalled();
      expect(kycRepo.update).not.toHaveBeenCalled();
    });

    it('should skip submissions without documentExpiresAt', async () => {
      const sub = makeSubmission({ documentExpiresAt: null as any });
      kycRepo.find.mockResolvedValue([sub]);
      await service.checkKycExpirations();
      expect(notificationsService.sendEmail).not.toHaveBeenCalled();
    });

    it('should send 30-day reminder when expiry is within 30 days and alert not sent', async () => {
      const sub = makeSubmission({ documentExpiresAt: makeDate(28) }); // 28 days ≤ 30 threshold
      kycRepo.find.mockResolvedValue([sub]);

      await service.checkKycExpirations();

      expect(notificationsService.sendEmail).toHaveBeenCalledTimes(1);
      const [to, subject] = notificationsService.sendEmail.mock.calls[0];
      expect(to).toBe('investor@agri-fi.com');
      expect(subject).toContain('30 days');
    });

    it('should send 14-day reminder when 30-day already sent and expiry is within 14 days', async () => {
      const sub = makeSubmission({
        documentExpiresAt: makeDate(10),
        alert30SentAt: new Date(), // 30d already sent
        alert15SentAt: null,
      });
      kycRepo.find.mockResolvedValue([sub]);

      await service.checkKycExpirations();

      expect(notificationsService.sendEmail).toHaveBeenCalledTimes(1);
      const [, subject] = notificationsService.sendEmail.mock.calls[0];
      expect(subject).toContain('14 days');
    });

    it('should send 7-day reminder when 30d and 14d already sent and expiry is within 7 days', async () => {
      const sub = makeSubmission({
        documentExpiresAt: makeDate(5),
        alert30SentAt: new Date(),
        alert15SentAt: new Date(),
        alert3SentAt: null,
      });
      kycRepo.find.mockResolvedValue([sub]);

      await service.checkKycExpirations();

      expect(notificationsService.sendEmail).toHaveBeenCalledTimes(1);
      const [, subject] = notificationsService.sendEmail.mock.calls[0];
      expect(subject).toContain('7 days');
    });

    it('should not resend a reminder that was already sent', async () => {
      const sub = makeSubmission({
        documentExpiresAt: makeDate(5),
        alert30SentAt: new Date(),
        alert15SentAt: new Date(),
        alert3SentAt: new Date(), // all sent
      });
      kycRepo.find.mockResolvedValue([sub]);

      await service.checkKycExpirations();

      expect(notificationsService.sendEmail).not.toHaveBeenCalled();
    });

    it('should mark the document as expired and notify when daysUntilExpiry ≤ 0', async () => {
      const sub = makeSubmission({ documentExpiresAt: makeDate(-1) }); // expired yesterday
      kycRepo.find.mockResolvedValue([sub]);

      await service.checkKycExpirations();

      expect(kycRepo.update).toHaveBeenCalledWith(sub.id, { status: 'expired' });
      expect(userRepo.update).toHaveBeenCalledWith(sub.userId, { kycStatus: 'expired' });
      expect(notificationsService.sendEmail).toHaveBeenCalledTimes(1);
      const [, subject] = notificationsService.sendEmail.mock.calls[0];
      expect(subject).toContain('expired');
    });

    it('should log a reminder event to the audit log', async () => {
      const sub = makeSubmission({
        documentExpiresAt: makeDate(6),
        alert30SentAt: new Date(), // 30d already sent
        alert15SentAt: new Date(), // 14d already sent
        alert3SentAt: null,
      });
      kycRepo.find.mockResolvedValue([sub]);

      await service.checkKycExpirations();

      expect(auditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          route: 'kyc-cron/reminder',
          actorId: sub.user.id,
          requestDetails: expect.objectContaining({
            event: 'kyc_expiry_reminder_sent',
            submissionId: sub.id,
            daysRemaining: 7,
          }),
        }),
      );
    });

    it('should log an expiry event to the audit log', async () => {
      const sub = makeSubmission({ documentExpiresAt: makeDate(-2) });
      kycRepo.find.mockResolvedValue([sub]);

      await service.checkKycExpirations();

      expect(auditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          route: 'kyc-cron/expired',
          requestDetails: expect.objectContaining({
            event: 'kyc_document_expired',
            submissionId: sub.id,
          }),
        }),
      );
    });

    it('should create an in-app notification for the user', async () => {
      const sub = makeSubmission({
        documentExpiresAt: makeDate(12),
        alert30SentAt: new Date(), // 30d already sent; 12d window → 14d fires
      });
      kycRepo.find.mockResolvedValue([sub]);

      await service.checkKycExpirations();

      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: sub.user.id,
          type: 'kyc',
          metadataJson: expect.objectContaining({ daysRemaining: 14 }),
        }),
      );
    });

    it('should include resubmission link in reminder email body', async () => {
      const sub = makeSubmission({ documentExpiresAt: makeDate(5) });
      kycRepo.find.mockResolvedValue([sub]);

      await service.checkKycExpirations();

      const [, , text] = notificationsService.sendEmail.mock.calls[0];
      expect(text).toContain('https://app.agri-fi.com/kyc/resubmit');
      expect(text).toContain(sub.user.id);
    });

    it('should handle errors gracefully without throwing', async () => {
      const sub = makeSubmission({ documentExpiresAt: makeDate(6) });
      kycRepo.find.mockResolvedValue([sub]);
      notificationsService.sendEmail.mockRejectedValue(new Error('SMTP error'));

      await expect(service.checkKycExpirations()).resolves.not.toThrow();
    });

    it('should process multiple submissions independently', async () => {
      const sub1 = makeSubmission({
        id: 'sub-1',
        userId: 'user-1',
        documentExpiresAt: makeDate(29),
        user: makeUser({ id: 'user-1', email: 'u1@test.com' }),
      });
      const sub2 = makeSubmission({
        id: 'sub-2',
        userId: 'user-2',
        documentExpiresAt: makeDate(10),
        alert30SentAt: new Date(),
        user: makeUser({ id: 'user-2', email: 'u2@test.com' }),
      });
      kycRepo.find.mockResolvedValue([sub1, sub2]);

      await service.checkKycExpirations();

      expect(notificationsService.sendEmail).toHaveBeenCalledTimes(2);
    });
  });
});
