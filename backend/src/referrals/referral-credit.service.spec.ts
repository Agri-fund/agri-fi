import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ReferralCreditService } from './referral-credit.service';
import { User } from '../auth/entities/user.entity';
import { Referral } from '../auth/entities/referral.entity';
import { ReferralCode } from '../auth/entities/referral-code.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { QueueService } from '../queue/queue.service';
import { BadRequestException } from '@nestjs/common';

describe('ReferralCreditService', () => {
  let service: ReferralCreditService;
  let userRepo: any;
  let referralRepo: any;
  let referralCodeRepo: any;
  let notificationsService: any;
  let queueService: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReferralCreditService,
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Referral),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ReferralCode),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            save: jest.fn(),
            create: jest.fn(),
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            sendReferralCreditEarnedEmail: jest.fn(),
          },
        },
        {
          provide: QueueService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<ReferralCreditService>(ReferralCreditService);
    userRepo = module.get(getRepositoryToken(User));
    referralRepo = module.get(getRepositoryToken(Referral));
    referralCodeRepo = module.get(getRepositoryToken(ReferralCode));
    notificationsService = module.get(NotificationsService);
    queueService = module.get(QueueService);
  });

  describe('generateReferralCode', () => {
    it('should generate an 8-character alphanumeric code', () => {
      const code = service.generateReferralCode();
      expect(code).toHaveLength(8);
      expect(/^[A-Za-z0-9]{8}$/.test(code)).toBe(true);
    });

    it('should generate unique codes on multiple calls', () => {
      const codes = new Set();
      for (let i = 0; i < 10; i++) {
        codes.add(service.generateReferralCode());
      }
      // Expect at least 9 unique codes out of 10 (very unlikely to have collision)
      expect(codes.size).toBeGreaterThanOrEqual(9);
    });
  });

  describe('createReferralCode', () => {
    it('should create a referral code for a user', async () => {
      const userId = 'user-123';
      const code = 'ABC12345';
      const createdCode = {
        id: 'code-id',
        userId,
        code,
        usesCount: 0,
        createdAt: new Date(),
      };

      referralCodeRepo.findOne.mockResolvedValue(null);
      referralCodeRepo.create.mockReturnValue(createdCode);
      referralCodeRepo.save.mockResolvedValue(createdCode);

      const result = await service.createReferralCode(userId);

      expect(result.userId).toBe(userId);
      expect(result.code).toBeDefined();
      expect(referralCodeRepo.save).toHaveBeenCalled();
    });

    it('should retry if code already exists', async () => {
      const userId = 'user-123';
      const existingCode = { code: 'ABC12345' };
      const newCode = { id: 'code-id', userId, code: 'XYZ98765', usesCount: 0 };

      referralCodeRepo.findOne
        .mockResolvedValueOnce(existingCode) // First call: exists
        .mockResolvedValueOnce(null); // Second call: doesn't exist

      referralCodeRepo.create.mockReturnValue(newCode);
      referralCodeRepo.save.mockResolvedValue(newCode);

      const result = await service.createReferralCode(userId);

      expect(result).toBeDefined();
      expect(referralCodeRepo.findOne).toHaveBeenCalledTimes(2);
    });
  });

  describe('checkFraudGuard', () => {
    it('should allow credit if IP has not reached limit', async () => {
      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      };

      referralRepo.createQueryBuilder.mockReturnValue(queryBuilder);

      const result = await service.checkFraudGuard('192.168.1.1');

      expect(result).toBe(true);
    });

    it('should block credit if IP has reached limit', async () => {
      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(2),
      };

      referralRepo.createQueryBuilder.mockReturnValue(queryBuilder);

      const result = await service.checkFraudGuard('192.168.1.1');

      expect(result).toBe(false);
    });

    it('should skip fraud check if no IP provided', async () => {
      const result = await service.checkFraudGuard(undefined);

      expect(result).toBe(true);
      expect(referralRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('issueCreditForFirstInvestment', () => {
    it('should issue credit when fraud guard passes', async () => {
      const referralId = 'referral-123';
      const referrerId = 'referrer-123';
      const referredUserId = 'referred-123';
      const ipAddress = '192.168.1.1';

      const referral = {
        id: referralId,
        referrerId,
        refereeId: referredUserId,
        status: 'registered',
        rewardAmount: 0,
        payoutStatus: 'pending',
        creditIssuedAt: null,
        createdAt: new Date(),
      };

      const referrer = {
        id: referrerId,
        email: 'referrer@example.com',
        platformCredit: 0,
      };

      const referredUser = {
        id: referredUserId,
        email: 'referred@example.com',
      };

      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      };

      referralRepo.findOne.mockResolvedValue(referral);
      userRepo.findOne
        .mockResolvedValueOnce(referrer)
        .mockResolvedValueOnce(referredUser);
      referralRepo.createQueryBuilder.mockReturnValue(queryBuilder);

      await service.issueCreditForFirstInvestment({
        referralId,
        referrerId,
        referredUserId,
        ipAddress,
      });

      expect(referral.status).toBe('rewarded');
      expect(referral.rewardAmount).toBe(5);
      expect(referral.creditIssuedAt).toBeDefined();
      expect(referrer.platformCredit).toBe(5);
      expect(notificationsService.sendReferralCreditEarnedEmail).toHaveBeenCalled();
    });

    it('should not issue credit if fraud guard fails', async () => {
      const referralId = 'referral-123';
      const referrerId = 'referrer-123';
      const referredUserId = 'referred-123';
      const ipAddress = '192.168.1.1';

      const referral = {
        id: referralId,
        referrerId,
        refereeId: referredUserId,
        status: 'registered',
        rewardAmount: 0,
        payoutStatus: 'pending',
        creditIssuedAt: null,
      };

      const referrer = {
        id: referrerId,
        email: 'referrer@example.com',
        platformCredit: 0,
      };

      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(2), // Max limit reached
      };

      referralRepo.findOne.mockResolvedValue(referral);
      userRepo.findOne.mockResolvedValue(referrer);
      referralRepo.createQueryBuilder.mockReturnValue(queryBuilder);

      await service.issueCreditForFirstInvestment({
        referralId,
        referrerId,
        referredUserId,
        ipAddress,
      });

      expect(referral.status).toBe('registered'); // Not changed to rewarded
      expect(referral.creditIssuedAt).toBeNull();
      expect(referrer.platformCredit).toBe(0); // Not credited
      expect(notificationsService.sendReferralCreditEarnedEmail).not.toHaveBeenCalled();
    });

    it('should throw if referral not found', async () => {
      referralRepo.findOne.mockResolvedValue(null);

      await expect(
        service.issueCreditForFirstInvestment({
          referralId: 'invalid',
          referrerId: 'referrer-123',
          referredUserId: 'referred-123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should not issue credit if already issued', async () => {
      const referralId = 'referral-123';
      const referral = {
        id: referralId,
        creditIssuedAt: new Date('2026-01-15'),
      };

      referralRepo.findOne.mockResolvedValue(referral);

      await service.issueCreditForFirstInvestment({
        referralId,
        referrerId: 'referrer-123',
        referredUserId: 'referred-123',
      });

      // Should return early without updating
      expect(referralRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('getReferralSummary', () => {
    it('should return referral summary with existing code', async () => {
      const userId = 'user-123';
      const codes = [
        {
          id: 'code-id-1',
          userId,
          code: 'ABC12345',
          usesCount: 2,
          createdAt: new Date('2026-01-01'),
        },
      ];

      const referrals = [
        {
          id: 'ref-1',
          referrerId: userId,
          status: 'rewarded',
          rewardAmount: 5,
          creditIssuedAt: new Date(),
        },
        {
          id: 'ref-2',
          referrerId: userId,
          status: 'registered',
          rewardAmount: 0,
          creditIssuedAt: null,
        },
      ];

      referralCodeRepo.find.mockResolvedValue(codes);
      referralRepo.find.mockResolvedValue(referrals);

      const result = await service.getReferralSummary(userId);

      expect(result.code).toBe('ABC12345');
      expect(result.codesCount).toBe(1);
      expect(result.totalEarnings).toBe(5);
      expect(result.creditsIssued).toBe(1);
      expect(result.referralsSent).toBe(2);
    });

    it('should create code if none exists', async () => {
      const userId = 'user-123';
      const newCode = {
        id: 'code-id',
        userId,
        code: 'NEW12345',
        usesCount: 0,
        createdAt: new Date(),
      };

      referralCodeRepo.find.mockResolvedValue([]);
      referralCodeRepo.create.mockReturnValue(newCode);
      referralCodeRepo.save.mockResolvedValue(newCode);
      referralRepo.find.mockResolvedValue([]);

      const result = await service.getReferralSummary(userId);

      expect(result.code).toBeDefined();
      expect(referralCodeRepo.save).toHaveBeenCalled();
    });
  });
});
