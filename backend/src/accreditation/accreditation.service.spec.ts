import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AccreditationService } from './accreditation.service';
import { User } from '../auth/entities/user.entity';
import type { AccreditationTier, AccreditationStatus } from '../auth/entities/user.entity';

function makeUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-uuid-123';
  user.email = 'investor@test.com';
  user.role = 'investor';
  user.accreditationTier = 'retail';
  user.accreditationStatus = 'none';
  user.accreditationSubmittedAt = null;
  user.accreditationApprovedAt = null;
  user.accreditationExpiresAt = null;
  user.accreditationDocumentUrl = null;
  user.accreditationDeclaration = null;
  user.accreditationRejectionReason = null;
  return Object.assign(user, overrides);
}

describe('AccreditationService', () => {
  let service: AccreditationService;
  let mockRepo: jest.Mocked<{
    findOne: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    createQueryBuilder: jest.Mock;
  }>;

  beforeEach(async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    mockRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (entity: User) => entity),
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(() => qb),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccreditationService,
        { provide: getRepositoryToken(User), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<AccreditationService>(AccreditationService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── submitSelfCertification ─────────────────────────────────────────────

  describe('submitSelfCertification', () => {
    it('throws NotFoundException when user does not exist', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.submitSelfCertification('bad-id', {
          declaration: 'I declare that I meet the criteria.',
          targetTier: 'accredited',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for non-investor role', async () => {
      mockRepo.findOne.mockResolvedValue(makeUser({ role: 'farmer' }));

      await expect(
        service.submitSelfCertification('user-uuid-123', {
          declaration: 'I declare that I meet the criteria.',
          targetTier: 'accredited',
        }),
      ).rejects.toMatchObject({ response: { code: 'NOT_INVESTOR' } });
    });

    it('throws ConflictException when application is already pending', async () => {
      mockRepo.findOne.mockResolvedValue(
        makeUser({ accreditationStatus: 'pending' }),
      );

      await expect(
        service.submitSelfCertification('user-uuid-123', {
          declaration: 'I declare that I meet the criteria.',
          targetTier: 'institutional',
        }),
      ).rejects.toMatchObject({ response: { code: 'APPLICATION_PENDING' } });
    });

    it('throws BadRequestException when declaration is too short', async () => {
      mockRepo.findOne.mockResolvedValue(makeUser());

      await expect(
        service.submitSelfCertification('user-uuid-123', {
          declaration: 'Short',
          targetTier: 'accredited',
        }),
      ).rejects.toMatchObject({ response: { code: 'DECLARATION_REQUIRED' } });
    });

    it('auto-approves accredited tier on self-certification', async () => {
      mockRepo.findOne.mockResolvedValue(makeUser());

      const result = await service.submitSelfCertification('user-uuid-123', {
        declaration: 'I certify that my net worth exceeds the required threshold.',
        targetTier: 'accredited',
      });

      expect(result.accreditationTier).toBe('accredited');
      expect(result.accreditationStatus).toBe('approved');
      expect(result.accreditationApprovedAt).toBeInstanceOf(Date);
      expect(result.accreditationExpiresAt).toBeInstanceOf(Date);

      // Expiry should be ~2 years in the future
      const twoYearsFromNow = new Date();
      twoYearsFromNow.setFullYear(twoYearsFromNow.getFullYear() + 2);
      const diff =
        Math.abs(result.accreditationExpiresAt!.getTime() - twoYearsFromNow.getTime());
      expect(diff).toBeLessThan(5_000); // within 5 seconds
    });

    it('queues institutional application for admin review', async () => {
      mockRepo.findOne.mockResolvedValue(makeUser());

      const result = await service.submitSelfCertification('user-uuid-123', {
        declaration: 'I certify institutional investor status as per regulations.',
        targetTier: 'institutional',
      });

      // Tier should NOT be upgraded until admin approves
      expect(result.accreditationTier).toBe('retail');
      expect(result.accreditationStatus).toBe('pending');
      expect(result.accreditationApprovedAt).toBeNull();
    });

    it('stores the document URL when provided', async () => {
      mockRepo.findOne.mockResolvedValue(makeUser());

      const docUrl = 'https://storage.example.com/doc.pdf';
      const result = await service.submitSelfCertification('user-uuid-123', {
        declaration: 'I certify that my net worth exceeds the required threshold.',
        targetTier: 'accredited',
        documentUrl: docUrl,
      });

      expect(result.accreditationDocumentUrl).toBe(docUrl);
    });
  });

  // ── reviewApplication ───────────────────────────────────────────────────

  describe('reviewApplication', () => {
    it('throws NotFoundException for unknown user', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.reviewApplication('bad-id', { approved: true }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when no application is pending', async () => {
      mockRepo.findOne.mockResolvedValue(makeUser({ accreditationStatus: 'none' }));

      await expect(
        service.reviewApplication('user-uuid-123', { approved: true }),
      ).rejects.toMatchObject({ response: { code: 'NOT_PENDING' } });
    });

    it('approves institutional application and sets 2-year expiry', async () => {
      mockRepo.findOne.mockResolvedValue(
        makeUser({ accreditationStatus: 'pending' }),
      );

      const result = await service.reviewApplication('user-uuid-123', {
        approved: true,
      });

      expect(result.accreditationTier).toBe('institutional');
      expect(result.accreditationStatus).toBe('approved');
      expect(result.accreditationApprovedAt).toBeInstanceOf(Date);
      expect(result.accreditationExpiresAt).toBeInstanceOf(Date);
      expect(result.accreditationRejectionReason).toBeNull();
    });

    it('rejects application and stores rejection reason', async () => {
      mockRepo.findOne.mockResolvedValue(
        makeUser({ accreditationStatus: 'pending' }),
      );

      const result = await service.reviewApplication('user-uuid-123', {
        approved: false,
        rejectionReason: 'Documentation insufficient.',
      });

      expect(result.accreditationStatus).toBe('rejected');
      expect(result.accreditationRejectionReason).toBe('Documentation insufficient.');
      expect(result.accreditationTier).toBe('retail'); // unchanged
    });
  });

  // ── getPendingApplications ───────────────────────────────────────────────

  describe('getPendingApplications', () => {
    it('returns users with pending accreditation status', async () => {
      const pendingUser = makeUser({ accreditationStatus: 'pending' });
      mockRepo.find.mockResolvedValue([pendingUser]);

      const result = await service.getPendingApplications();

      expect(result).toHaveLength(1);
      expect(mockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { accreditationStatus: 'pending' },
        }),
      );
    });
  });

  // ── expireStaleAccreditations ───────────────────────────────────────────

  describe('expireStaleAccreditations', () => {
    it('returns 0 when no expired accreditations found', async () => {
      // createQueryBuilder returns empty getMany
      const count = await service.expireStaleAccreditations();
      expect(count).toBe(0);
    });

    it('downgrades expired users to retail tier and marks status as expired', async () => {
      const expiredUser = makeUser({
        accreditationTier: 'accredited',
        accreditationStatus: 'approved',
        accreditationExpiresAt: new Date(Date.now() - 1000),
      });

      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([expiredUser]),
      };
      mockRepo.createQueryBuilder.mockReturnValue(qb);
      mockRepo.save.mockImplementation(async (arr: User[]) => arr);

      const count = await service.expireStaleAccreditations();

      expect(count).toBe(1);
      expect(expiredUser.accreditationStatus).toBe('expired');
      expect(expiredUser.accreditationTier).toBe('retail');
    });
  });
});
