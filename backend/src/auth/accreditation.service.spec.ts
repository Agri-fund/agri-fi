import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AccreditationService } from './accreditation.service';
import { User, AccreditationTier } from './entities/user.entity';
import { AccreditationReview } from './entities/accreditation-review.entity';
import { AnnualInvestmentCap } from './entities/annual-investment-cap.entity';

const mockUserRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  update: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
});

const mockReviewRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  update: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
});

const mockCapRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  update: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
});

const mockLogger = () => ({
  setContext: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

describe('AccreditationService', () => {
  let service: AccreditationService;
  let userRepo: jest.Mocked<Repository<User>>;
  let reviewRepo: jest.Mocked<Repository<AccreditationReview>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccreditationService,
        { provide: getRepositoryToken(User), useFactory: mockUserRepo },
        { provide: getRepositoryToken(AnnualInvestmentCap), useFactory: mockCapRepo },
        { provide: getRepositoryToken(AccreditationReview), useFactory: mockReviewRepo },
        { provide: PinoLogger, useFactory: mockLogger },
      ],
    }).compile();

    service = module.get<AccreditationService>(AccreditationService);
    userRepo = module.get(getRepositoryToken(User));
    reviewRepo = module.get(getRepositoryToken(AccreditationReview));
  });

  afterEach(() => jest.clearAllMocks());

  // ── submitDeclaration ────────────────────────────────────────────────────

  describe('submitDeclaration', () => {
    it('creates a pending review record when user exists', async () => {
      const userId = 'user-uuid-1';
      const mockUser: Partial<User> = { id: userId };
      const savedReview: Partial<AccreditationReview> = {
        id: 'review-uuid-1',
        userId,
        tierRequested: 'accredited',
        documentUrl: 'https://example.com/doc.pdf',
        status: 'pending',
      };

      userRepo.findOne.mockResolvedValue(mockUser as User);
      userRepo.update.mockResolvedValue({ affected: 1 } as any);
      reviewRepo.create.mockReturnValue(savedReview as AccreditationReview);
      reviewRepo.save.mockResolvedValue(savedReview as AccreditationReview);

      const result = await service.submitDeclaration(
        userId,
        'accredited',
        'https://example.com/doc.pdf',
      );

      expect(userRepo.update).toHaveBeenCalledWith(userId, {
        accreditationStatus: 'pending',
      });
      expect(reviewRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          tierRequested: 'accredited',
          documentUrl: 'https://example.com/doc.pdf',
          status: 'pending',
        }),
      );
      expect(reviewRepo.save).toHaveBeenCalledWith(savedReview);
      expect(result.status).toBe('pending');
    });

    it('throws NotFoundException when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.submitDeclaration('non-existent', 'accredited'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── approveAccreditation ─────────────────────────────────────────────────

  describe('approveAccreditation', () => {
    it('sets user tier, status=approved, and accreditationExpiresAt ~2 years from now', async () => {
      const userId = 'user-uuid-2';
      const adminId = 'admin-uuid-1';
      const pendingReview: Partial<AccreditationReview> = {
        id: 'review-uuid-2',
        userId,
        tierRequested: 'accredited',
        status: 'pending',
      };
      const approvedUser: Partial<User> = {
        id: userId,
        accreditationTier: 'accredited',
        accreditationStatus: 'approved',
      };

      reviewRepo.findOne.mockResolvedValue(pendingReview as AccreditationReview);
      reviewRepo.update.mockResolvedValue({ affected: 1 } as any);
      userRepo.update.mockResolvedValue({ affected: 1 } as any);
      userRepo.findOne.mockResolvedValue(approvedUser as User);

      const result = await service.approveAccreditation(userId, adminId);

      expect(reviewRepo.update).toHaveBeenCalledWith(
        pendingReview.id,
        expect.objectContaining({ status: 'approved', reviewedBy: adminId }),
      );
      expect(userRepo.update).toHaveBeenCalledWith(
        userId,
        expect.objectContaining({
          accreditationStatus: 'approved',
          accreditationTier: 'accredited',
          accreditationExpiresAt: expect.any(Date),
        }),
      );

      // Verify expiry is approximately 2 years from now
      const updateCall = (userRepo.update as jest.Mock).mock.calls[0][1];
      const expiresAt: Date = updateCall.accreditationExpiresAt;
      const twoYearsFromNow = new Date();
      twoYearsFromNow.setFullYear(twoYearsFromNow.getFullYear() + 2);
      const diffMs = Math.abs(expiresAt.getTime() - twoYearsFromNow.getTime());
      expect(diffMs).toBeLessThan(5000); // within 5 seconds

      expect(result.accreditationTier).toBe('accredited');
      expect(result.accreditationStatus).toBe('approved');
    });

    it('throws NotFoundException when no pending review exists', async () => {
      reviewRepo.findOne.mockResolvedValue(null);

      await expect(
        service.approveAccreditation('some-user', 'admin'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── getUserTier ──────────────────────────────────────────────────────────

  describe('getUserTier', () => {
    it('returns retail tier for expired users regardless of stored tier', () => {
      const expiredUser: Partial<User> = {
        id: 'user-3',
        accreditationTier: 'institutional',
        accreditationStatus: 'expired',
      };
      const tier = service.getUserTier(expiredUser as User);
      expect(tier).toBe('retail');
    });

    it('returns stored tier for approved users', () => {
      const approvedUser: Partial<User> = {
        id: 'user-4',
        accreditationTier: 'accredited',
        accreditationStatus: 'approved',
      };
      const tier = service.getUserTier(approvedUser as User);
      expect(tier).toBe('accredited');
    });

    it('returns retail tier for users with status none', () => {
      const newUser: Partial<User> = {
        id: 'user-5',
        accreditationTier: 'retail',
        accreditationStatus: 'none',
      };
      const tier = service.getUserTier(newUser as User);
      expect(tier).toBe('retail');
    });
  });

  // ── checkAccreditationExpiry ─────────────────────────────────────────────

  describe('checkAccreditationExpiry', () => {
    it('sets expired users back to retail tier and expired status', async () => {
      const expiredUser: Partial<User> = {
        id: 'user-6',
        accreditationTier: 'accredited',
        accreditationStatus: 'approved',
        accreditationExpiresAt: new Date('2020-01-01'),
      };

      userRepo.find.mockResolvedValue([expiredUser] as User[]);
      userRepo.update.mockResolvedValue({ affected: 1 } as any);

      await service.checkAccreditationExpiry();

      expect(userRepo.update).toHaveBeenCalledWith(expiredUser.id, {
        accreditationStatus: 'expired',
        accreditationTier: 'retail',
      });
    });

    it('does nothing when no users have expired accreditation', async () => {
      userRepo.find.mockResolvedValue([]);

      await service.checkAccreditationExpiry();

      expect(userRepo.update).not.toHaveBeenCalled();
    });
  });

  // ── getPendingReviews ────────────────────────────────────────────────────

  describe('getPendingReviews', () => {
    it('returns all pending reviews', async () => {
      const reviews: Partial<AccreditationReview>[] = [
        { id: 'r1', status: 'pending', tierRequested: 'accredited' },
        { id: 'r2', status: 'pending', tierRequested: 'institutional' },
      ];
      reviewRepo.find.mockResolvedValue(reviews as AccreditationReview[]);

      const result = await service.getPendingReviews();

      expect(reviewRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'pending' } }),
      );
      expect(result).toHaveLength(2);
    });
  });
});
