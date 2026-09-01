/**
 * @file bulk-kyc.service.spec.ts
 * Unit tests for AuthService.bulkApproveOrRejectKyc (#800)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';
import { KycSubmission } from './entities/kyc-submission.entity';
import { AdminAction } from '../database/entities/admin-action.entity';
import { LoginLog } from '../database/entities/login-log.entity';
import { QueueService } from '../queue/queue.service';
import { AuditService } from '../audit/audit.service';
import { OfacSanctionsCheckService } from './utils/ofac-sanctions-check';
import { TokenBlocklistService } from './token-blocklist.service';
import { SecurityThreatService } from './security-threat.service';

const mockUser = (overrides: Partial<User> = {}): User =>
  ({
    id: 'user-1',
    email: 'alice@example.com',
    passwordHash: '',
    role: 'farmer',
    country: 'NG',
    kycStatus: 'pending',
    tokenVersion: 0,
    walletAddress: null,
    isCompany: false,
    companyDetails: null,
    createdAt: new Date(),
    fullName: null,
    birthdate: null,
    taxId: null,
    ...overrides,
  }) as User;

const mockSubmission = (overrides = {}) => ({
  id: 'sub-1',
  userId: 'user-1',
  status: 'pending_review',
  isCorporate: false,
  createdAt: new Date(),
  ...overrides,
});

describe('AuthService – bulkApproveOrRejectKyc (#800)', () => {
  let service: AuthService;
  let userRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    findAndCount: jest.Mock;
  };
  let kycRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock };
  let adminActionRepo: { create: jest.Mock; save: jest.Mock };
  let queueService: { emit: jest.Mock };
  let auditService: { logEvent: jest.Mock };

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (e) => e),
      create: jest.fn((e) => e),
      findAndCount: jest.fn(),
    };
    kycRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (e) => e),
      create: jest.fn((e) => e),
    };
    adminActionRepo = {
      create: jest.fn((e) => e),
      save: jest.fn(async (e) => e),
    };
    queueService = { emit: jest.fn() };
    auditService = { logEvent: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(KycSubmission), useValue: kycRepo },
        { provide: getRepositoryToken(AdminAction), useValue: adminActionRepo },
        {
          provide: getRepositoryToken(LoginLog),
          useValue: { create: jest.fn(), save: jest.fn() },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('tok'),
            verify: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(), getOrThrow: jest.fn() },
        },
        { provide: QueueService, useValue: queueService },
        { provide: AuditService, useValue: auditService },
        {
          provide: OfacSanctionsCheckService,
          useValue: {
            checkName: jest.fn().mockResolvedValue({ blocked: false }),
          },
        },
        {
          provide: TokenBlocklistService,
          useValue: {
            isBlocklisted: jest.fn().mockResolvedValue(false),
            add: jest.fn(),
          },
        },
        {
          provide: SecurityThreatService,
          useValue: { recordLoginAttempt: jest.fn(), listBlocks: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // ── Approve ───────────────────────────────────────────────────────────────

  describe('bulk approve', () => {
    it('approves a single pending KYC submission', async () => {
      const user = mockUser();
      const submission = mockSubmission();
      userRepo.findOne.mockResolvedValue(user);
      kycRepo.findOne.mockResolvedValue(submission);

      const result = await service.bulkApproveOrRejectKyc({
        userIds: ['user-1'],
        action: 'approve',
        adminId: 'admin-1',
        adminRole: 'admin',
      });

      expect(result.processed).toHaveLength(1);
      expect(result.processed[0].kycStatus).toBe('verified');
      expect(result.failures).toHaveLength(0);
      expect(kycRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'approved' }),
      );
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ kycStatus: 'verified' }),
      );
    });

    it('emits email.notification event with type kyc_verified on approve', async () => {
      userRepo.findOne.mockResolvedValue(mockUser());
      kycRepo.findOne.mockResolvedValue(mockSubmission());

      await service.bulkApproveOrRejectKyc({
        userIds: ['user-1'],
        action: 'approve',
        adminId: 'admin-1',
      });

      expect(queueService.emit).toHaveBeenCalledWith(
        'email.notification',
        expect.objectContaining({ type: 'kyc_verified', userId: 'user-1' }),
      );
    });

    it('writes an individual system_audit_log entry per user approved', async () => {
      userRepo.findOne.mockResolvedValue(mockUser());
      kycRepo.findOne.mockResolvedValue(mockSubmission());

      await service.bulkApproveOrRejectKyc({
        userIds: ['user-1'],
        action: 'approve',
        adminId: 'admin-1',
        adminRole: 'admin',
      });

      expect(auditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'admin-1',
          actorRole: 'admin',
          route: 'PATCH /admin/kyc/bulk',
          requestDetails: expect.objectContaining({
            action: 'approve',
            userId: 'user-1',
          }),
        }),
      );
    });

    it('approves multiple users in one call', async () => {
      const users = [
        mockUser({ id: 'u-1', email: 'a@x.com' }),
        mockUser({ id: 'u-2', email: 'b@x.com' }),
      ];
      const subs = [
        mockSubmission({ id: 's-1', userId: 'u-1' }),
        mockSubmission({ id: 's-2', userId: 'u-2' }),
      ];

      userRepo.findOne
        .mockResolvedValueOnce(users[0])
        .mockResolvedValueOnce(users[1]);
      kycRepo.findOne
        .mockResolvedValueOnce(subs[0])
        .mockResolvedValueOnce(subs[1]);

      const result = await service.bulkApproveOrRejectKyc({
        userIds: ['u-1', 'u-2'],
        action: 'approve',
        adminId: 'admin-1',
      });

      expect(result.processed).toHaveLength(2);
      expect(result.failures).toHaveLength(0);
      expect(queueService.emit).toHaveBeenCalledTimes(2);
    });

    it('sets isCompany and companyDetails on corporate approval', async () => {
      const user = mockUser();
      const corporateSub = mockSubmission({
        isCorporate: true,
        companyName: 'Acme Ltd',
        registrationNumber: 'RC12345',
        articlesOfIncorporationUrl: 'http://example.com/doc.pdf',
      });
      userRepo.findOne.mockResolvedValue(user);
      kycRepo.findOne.mockResolvedValue(corporateSub);

      await service.bulkApproveOrRejectKyc({
        userIds: ['user-1'],
        action: 'approve',
        adminId: 'admin-1',
      });

      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          isCompany: true,
          kycStatus: 'verified',
        }),
      );
    });
  });

  // ── Reject ────────────────────────────────────────────────────────────────

  describe('bulk reject', () => {
    it('rejects a pending KYC submission and sets user kycStatus to rejected', async () => {
      userRepo.findOne.mockResolvedValue(mockUser());
      kycRepo.findOne.mockResolvedValue(mockSubmission());

      const result = await service.bulkApproveOrRejectKyc({
        userIds: ['user-1'],
        action: 'reject',
        reason: 'Documents expired',
        adminId: 'admin-1',
      });

      expect(result.processed).toHaveLength(1);
      expect(result.processed[0].kycStatus).toBe('rejected');
      expect(result.failures).toHaveLength(0);
      expect(kycRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'rejected' }),
      );
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ kycStatus: 'rejected' }),
      );
    });

    it('emits email.notification event with type kyc_rejected on reject', async () => {
      userRepo.findOne.mockResolvedValue(mockUser());
      kycRepo.findOne.mockResolvedValue(mockSubmission());

      await service.bulkApproveOrRejectKyc({
        userIds: ['user-1'],
        action: 'reject',
        reason: 'Name mismatch',
        adminId: 'admin-1',
      });

      expect(queueService.emit).toHaveBeenCalledWith(
        'email.notification',
        expect.objectContaining({
          type: 'kyc_rejected',
          reason: 'Name mismatch',
        }),
      );
    });

    it('throws BadRequestException when reject action has no reason', async () => {
      await expect(
        service.bulkApproveOrRejectKyc({
          userIds: ['user-1'],
          action: 'reject',
          adminId: 'admin-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when reject reason is whitespace only', async () => {
      await expect(
        service.bulkApproveOrRejectKyc({
          userIds: ['user-1'],
          action: 'reject',
          reason: '   ',
          adminId: 'admin-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('writes an individual system_audit_log entry per user rejected', async () => {
      userRepo.findOne.mockResolvedValue(mockUser());
      kycRepo.findOne.mockResolvedValue(mockSubmission());

      await service.bulkApproveOrRejectKyc({
        userIds: ['user-1'],
        action: 'reject',
        reason: 'Fraud detected',
        adminId: 'admin-1',
        adminRole: 'admin',
      });

      expect(auditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          route: 'PATCH /admin/kyc/bulk',
          requestDetails: expect.objectContaining({
            action: 'reject',
            userId: 'user-1',
            reason: 'Fraud detected',
          }),
        }),
      );
    });
  });

  // ── Partial failure ───────────────────────────────────────────────────────

  describe('partial failure handling', () => {
    it('records failure when user is not found and continues processing others', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(null) // u-1 not found
        .mockResolvedValueOnce(mockUser({ id: 'u-2', email: 'b@x.com' }));
      kycRepo.findOne.mockResolvedValue(mockSubmission({ userId: 'u-2' }));

      const result = await service.bulkApproveOrRejectKyc({
        userIds: ['u-1', 'u-2'],
        action: 'approve',
        adminId: 'admin-1',
      });

      expect(result.processed).toHaveLength(1);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]).toMatchObject({
        userId: 'u-1',
        reason: 'User not found.',
      });
    });

    it('records failure when user has no pending KYC submission', async () => {
      userRepo.findOne.mockResolvedValue(mockUser());
      kycRepo.findOne.mockResolvedValue(null);

      const result = await service.bulkApproveOrRejectKyc({
        userIds: ['user-1'],
        action: 'approve',
        adminId: 'admin-1',
      });

      expect(result.processed).toHaveLength(0);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].reason).toMatch(/No pending KYC/i);
    });

    it('does not abort the entire batch when one user throws an unexpected error', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(mockUser({ id: 'u-1', email: 'a@x.com' }))
        .mockResolvedValueOnce(mockUser({ id: 'u-2', email: 'b@x.com' }));
      kycRepo.findOne
        .mockResolvedValueOnce(mockSubmission())
        .mockRejectedValueOnce(new Error('DB timeout'));

      const result = await service.bulkApproveOrRejectKyc({
        userIds: ['u-1', 'u-2'],
        action: 'approve',
        adminId: 'admin-1',
      });

      expect(result.processed).toHaveLength(1);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]).toMatchObject({
        userId: 'u-2',
        reason: 'DB timeout',
      });
    });
  });
});
