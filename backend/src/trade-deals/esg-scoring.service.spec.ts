import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { EsgScoringService, EsgQuestionnaireDto } from './esg-scoring.service';
import { TradeDeal } from './entities/trade-deal.entity';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

describe('EsgScoringService', () => {
  let service: EsgScoringService;
  let dealRepo: any;

  const mockDeal: Partial<TradeDeal> = {
    id: 'deal-123',
    commodity: 'Cocoa',
    farmerId: 'farmer-1',
    traderId: 'trader-1',
    esgStatus: 'unrated',
  };

  beforeEach(async () => {
    dealRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EsgScoringService,
        {
          provide: getRepositoryToken(TradeDeal),
          useValue: dealRepo,
        },
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

    service = module.get<EsgScoringService>(EsgScoringService);
  });

  describe('calculateScore', () => {
    it('computes a high ESG score and AAA rating for sustainable practices', () => {
      const answers: EsgQuestionnaireDto = {
        deforestationFree: true,
        waterEfficiencyRating: 95,
        organicOrRegenerativePractices: true,
        renewableEnergyUsagePercent: 80,
        chemicalFertilizerReductionPercent: 70,

        childLaborSafeguardsVerified: true,
        workerSafetyProtocol: true,
        fairPricePremiumPercent: 15,
        femaleOrYouthFarmerInclusionPercent: 60,
        communityReinvestment: true,

        traceabilityLevel: 'blockchain_tokenized',
        clearLandTenureVerified: true,
        independentQualityAudit: true,
        antiCorruptionCompliance: true,
      };

      const result = service.calculateScore(answers);

      expect(result.esgScore).toBeGreaterThanOrEqual(85);
      expect(result.esgRating).toBe('AAA');
      expect(result.environmentalScore).toBeGreaterThan(80);
      expect(result.socialScore).toBeGreaterThan(80);
      expect(result.governanceScore).toBeGreaterThan(80);
      expect(result.breakdown.environmental.weight).toBe('40%');
      expect(result.breakdown.social.weight).toBe('35%');
      expect(result.breakdown.governance.weight).toBe('25%');
    });

    it('computes lower scores and CCC rating for poor ESG practices', () => {
      const answers: EsgQuestionnaireDto = {
        deforestationFree: false,
        waterEfficiencyRating: 20,
        organicOrRegenerativePractices: false,
        renewableEnergyUsagePercent: 0,

        childLaborSafeguardsVerified: false,
        workerSafetyProtocol: false,
        fairPricePremiumPercent: 0,
        femaleOrYouthFarmerInclusionPercent: 5,
        communityReinvestment: false,

        traceabilityLevel: 'basic',
        clearLandTenureVerified: false,
        independentQualityAudit: false,
        antiCorruptionCompliance: false,
      };

      const result = service.calculateScore(answers);

      expect(result.esgScore).toBeLessThan(35);
      expect(result.esgRating).toBe('CCC');
    });
  });

  describe('submitQuestionnaire', () => {
    it('saves score and sets status to pending_review for authorized trader', async () => {
      dealRepo.findOne.mockResolvedValue({ ...mockDeal });

      const answers: EsgQuestionnaireDto = {
        deforestationFree: true,
        waterEfficiencyRating: 80,
        organicOrRegenerativePractices: true,
        renewableEnergyUsagePercent: 50,
        childLaborSafeguardsVerified: true,
        workerSafetyProtocol: true,
        fairPricePremiumPercent: 10,
        femaleOrYouthFarmerInclusionPercent: 40,
        communityReinvestment: true,
        traceabilityLevel: 'iot_sensor_verified',
        clearLandTenureVerified: true,
        independentQualityAudit: true,
        antiCorruptionCompliance: true,
      };

      const saved = await service.submitQuestionnaire('deal-123', 'trader-1', answers);

      expect(dealRepo.findOne).toHaveBeenCalledWith({ where: { id: 'deal-123' } });
      expect(saved.esgStatus).toBe('pending_review');
      expect(saved.esgScore).toBeDefined();
      expect(saved.esgRating).toBeDefined();
      expect(dealRepo.save).toHaveBeenCalled();
    });

    it('throws ForbiddenException if non-participant tries to submit', async () => {
      dealRepo.findOne.mockResolvedValue({ ...mockDeal });

      await expect(
        service.submitQuestionnaire('deal-123', 'unrelated-user', {} as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException if deal does not exist', async () => {
      dealRepo.findOne.mockResolvedValue(null);

      await expect(
        service.submitQuestionnaire('invalid-deal', 'trader-1', {} as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('reviewScore', () => {
    it('allows admin to approve an ESG score with review notes', async () => {
      dealRepo.findOne.mockResolvedValue({
        ...mockDeal,
        esgStatus: 'pending_review',
        esgScore: 82,
        esgRating: 'AA',
      });

      const updated = await service.reviewScore(
        'deal-123',
        'admin-user',
        true,
        'Verified satellite deforestation data',
      );

      expect(updated.esgStatus).toBe('approved');
      expect(updated.esgReviewedBy).toBe('admin-user');
      expect(updated.esgReviewNotes).toBe('Verified satellite deforestation data');
      expect(updated.esgReviewedAt).toBeDefined();
    });

    it('allows admin to approve with adjusted score', async () => {
      dealRepo.findOne.mockResolvedValue({
        ...mockDeal,
        esgStatus: 'pending_review',
        esgScore: 70,
        esgRating: 'A',
      });

      const updated = await service.reviewScore(
        'deal-123',
        'admin-user',
        true,
        'Awarded bonus for verified organic certification',
        88,
      );

      expect(updated.esgStatus).toBe('approved');
      expect(updated.esgScore).toBe(88);
      expect(updated.esgRating).toBe('AAA');
    });

    it('allows admin to reject ESG questionnaire submission', async () => {
      dealRepo.findOne.mockResolvedValue({
        ...mockDeal,
        esgStatus: 'pending_review',
      });

      const updated = await service.reviewScore(
        'deal-123',
        'admin-user',
        false,
        'Failed child labor audit documentation',
      );

      expect(updated.esgStatus).toBe('rejected');
      expect(updated.esgReviewNotes).toBe('Failed child labor audit documentation');
    });
  });
});
