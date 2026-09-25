import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  FarmerCreditScoringService,
  ScoreFactorsInput,
  FACTOR_WEIGHTS,
} from './farmer-credit-scoring.service';
import { User } from '../auth/entities/user.entity';
import { FarmerCreditScoreHistory } from './entities/farmer-credit-score-history.entity';

describe('FarmerCreditScoringService - Disclosure, Permissions & Weighting (#1016)', () => {
  let service: FarmerCreditScoringService;
  let userRepo: any;
  let historyRepo: any;
  let cacheManager: any;

  const mockFarmer: Partial<User> = {
    id: 'farmer-uuid-1',
    role: 'farmer',
    creditScore: 720,
    createdAt: new Date('2024-01-01'),
  };

  const mockInvestor: Partial<User> = {
    id: 'investor-uuid-1',
    role: 'investor',
    creditScore: null,
  };

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn(),
      save: jest.fn((u) => Promise.resolve(u)),
    };
    historyRepo = {
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve(data)),
    };
    cacheManager = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FarmerCreditScoringService,
        {
          provide: getRepositoryToken(User),
          useValue: userRepo,
        },
        {
          provide: getRepositoryToken(FarmerCreditScoreHistory),
          useValue: historyRepo,
        },
        {
          provide: CACHE_MANAGER,
          useValue: cacheManager,
        },
      ],
    }).compile();

    service = module.get<FarmerCreditScoringService>(FarmerCreditScoringService);
  });

  describe('Factor Weighting Verification', () => {
    it('verifies exact mathematical weights sum to 1.0 (100%)', () => {
      const sum =
        FACTOR_WEIGHTS.onTimeRepayment +
        FACTOR_WEIGHTS.dealCompletion +
        FACTOR_WEIGHTS.defaultRate +
        FACTOR_WEIGHTS.shipmentMilestone +
        FACTOR_WEIGHTS.kycAge;

      expect(sum).toBeCloseTo(1.0, 5);
      expect(FACTOR_WEIGHTS.onTimeRepayment).toBe(0.35);
      expect(FACTOR_WEIGHTS.dealCompletion).toBe(0.20);
      expect(FACTOR_WEIGHTS.defaultRate).toBe(0.20);
      expect(FACTOR_WEIGHTS.shipmentMilestone).toBe(0.15);
      expect(FACTOR_WEIGHTS.kycAge).toBe(0.10);
    });

    it('calculates 850 score for perfect factors across all dimensions', () => {
      const perfectFactors: ScoreFactorsInput = {
        onTimeRepaymentRate: 1.0,
        dealCompletionRate: 1.0,
        dealDefaultRate: 0.0, // 0 default = 100% inverted
        shipmentMilestoneComplianceRate: 1.0,
        kycVerificationAgeDays: 365,
      };

      const score = service.calculateScoreFromFactors(perfectFactors);
      expect(score).toBe(850);
      expect(service.deriveScoreTier(score)).toBe('Excellent');
      expect(service.deriveMaxDealSize(score)).toBe(200000);
    });

    it('calculates 300 base score for zero performance factors', () => {
      const zeroFactors: ScoreFactorsInput = {
        onTimeRepaymentRate: 0.0,
        dealCompletionRate: 0.0,
        dealDefaultRate: 1.0, // 100% default = 0% inverted
        shipmentMilestoneComplianceRate: 0.0,
        kycVerificationAgeDays: 0,
      };

      const score = service.calculateScoreFromFactors(zeroFactors);
      expect(score).toBe(300);
      expect(service.deriveScoreTier(score)).toBe('Poor');
      expect(service.deriveMaxDealSize(score)).toBe(10000);
    });
  });

  describe('Permissions & Access Control', () => {
    it('allows farmer user to access credit score disclosure', async () => {
      userRepo.findOne.mockResolvedValue(mockFarmer);

      const disclosure = await service.getCreditScoreDisclosure('farmer-uuid-1');

      expect(disclosure).toBeDefined();
      expect(disclosure.score).toBe(720);
      expect(disclosure.breakdown).toBeDefined();
      expect(disclosure.tips).toBeInstanceOf(Array);
      expect(cacheManager.set).toHaveBeenCalledWith(
        'farmer:credit-score:farmer-uuid-1',
        expect.any(Object),
        900000,
      );
    });

    it('denies investor user with ForbiddenException', async () => {
      userRepo.findOne.mockResolvedValue(mockInvestor);

      await expect(
        service.getCreditScoreDisclosure('investor-uuid-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for non-existent user', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getCreditScoreDisclosure('unknown-uuid'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Caching & Cache Invalidation', () => {
    it('returns cached disclosure if available in Redis', async () => {
      const cachedData = {
        score: 750,
        tier: 'Excellent' as const,
        maxDealSizeUsdc: 200000,
        factors: {
          onTimeRepaymentRate: 1,
          dealCompletionRate: 1,
          dealDefaultRate: 0,
          shipmentMilestoneComplianceRate: 1,
          kycVerificationAgeDays: 365,
        },
        breakdown: {},
        tips: ['Great job!'],
        lastUpdated: '2026-09-25T00:00:00.000Z',
        cached: false,
      };
      userRepo.findOne.mockResolvedValue(mockFarmer);
      cacheManager.get.mockResolvedValue(cachedData);

      const result = await service.getCreditScoreDisclosure('farmer-uuid-1');

      expect(result.cached).toBe(true);
      expect(result.score).toBe(750);
      expect(cacheManager.set).not.toHaveBeenCalled();
    });

    it('invalidates cache when computeScore recalculates score', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockFarmer });

      await service.computeScore('farmer-uuid-1', 'Recalculation');

      expect(cacheManager.del).toHaveBeenCalledWith('farmer:credit-score:farmer-uuid-1');
    });

    it('invalidates cache when manualOverride updates score', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockFarmer });

      await service.manualOverride('admin-1', 'farmer-uuid-1', 800, 'Score correction');

      expect(cacheManager.del).toHaveBeenCalledWith('farmer:credit-score:farmer-uuid-1');
    });
  });

  describe('Actionable Tips Generation', () => {
    it('generates specific tips targeting weak factor areas', () => {
      const weakFactors: ScoreFactorsInput = {
        onTimeRepaymentRate: 0.70, // Weak repayment
        dealCompletionRate: 0.60,  // Weak completion
        dealDefaultRate: 0.15,     // Has defaults
        shipmentMilestoneComplianceRate: 0.50, // Poor milestone logging
        kycVerificationAgeDays: 30, // New KYC
      };

      const tips = service.generateTips(weakFactors, 480);

      expect(tips.length).toBeGreaterThanOrEqual(4);
      expect(tips.some((t) => t.includes('on-time delivery'))).toBe(true);
      expect(tips.some((t) => t.includes('milestone updates'))).toBe(true);
      expect(tips.some((t) => t.includes('defaults'))).toBe(true);
    });
  });
});
