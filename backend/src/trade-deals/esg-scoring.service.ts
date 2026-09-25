import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { TradeDeal } from './entities/trade-deal.entity';

export interface EsgQuestionnaireDto {
  // Environmental questions (0 - 100 or specific metrics)
  deforestationFree: boolean;
  waterEfficiencyRating: number; // 0 - 100
  organicOrRegenerativePractices: boolean;
  renewableEnergyUsagePercent: number; // 0 - 100
  chemicalFertilizerReductionPercent?: number; // 0 - 100

  // Social questions
  fairPricePremiumPercent: number; // premium paid above local market rate, e.g. 15%
  workerSafetyProtocol: boolean;
  childLaborSafeguardsVerified: boolean;
  femaleOrYouthFarmerInclusionPercent: number; // 0 - 100
  communityReinvestment: boolean;

  // Governance questions
  traceabilityLevel: 'basic' | 'gps_tagged' | 'iot_sensor_verified' | 'blockchain_tokenized';
  clearLandTenureVerified: boolean;
  independentQualityAudit: boolean;
  antiCorruptionCompliance: boolean;

  additionalCertifications?: string[];
  notes?: string;
}

export interface EsgScoreCalculationResult {
  esgScore: number;
  environmentalScore: number;
  socialScore: number;
  governanceScore: number;
  esgRating: 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'B' | 'CCC';
  breakdown: Record<string, any>;
}

@Injectable()
export class EsgScoringService {
  constructor(
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(EsgScoringService.name);
  }

  /**
   * Computes ESG sub-scores and aggregate score based on the standardized
   * institutional agricultural questionnaire.
   */
  public calculateScore(answers: EsgQuestionnaireDto): EsgScoreCalculationResult {
    // 1. Environmental Sub-score (Weight: 40%)
    let envScore = 0;
    envScore += answers.deforestationFree ? 30 : 0;
    envScore += (Math.min(Math.max(answers.waterEfficiencyRating, 0), 100) / 100) * 25;
    envScore += answers.organicOrRegenerativePractices ? 25 : 10;
    envScore += (Math.min(Math.max(answers.renewableEnergyUsagePercent, 0), 100) / 100) * 10;
    if (answers.chemicalFertilizerReductionPercent) {
      envScore += (Math.min(Math.max(answers.chemicalFertilizerReductionPercent, 0), 100) / 100) * 10;
    } else {
      envScore += 5;
    }
    const environmentalScore = Math.min(Math.round(envScore * 10) / 10, 100);

    // 2. Social Sub-score (Weight: 35%)
    let socScore = 0;
    socScore += answers.childLaborSafeguardsVerified ? 35 : 0;
    socScore += answers.workerSafetyProtocol ? 20 : 0;
    socScore += Math.min(Math.max(answers.fairPricePremiumPercent * 2, 0), 20); // 10% premium = full 20 pts
    socScore += (Math.min(Math.max(answers.femaleOrYouthFarmerInclusionPercent, 0), 100) / 100) * 15;
    socScore += answers.communityReinvestment ? 10 : 0;
    const socialScore = Math.min(Math.round(socScore * 10) / 10, 100);

    // 3. Governance Sub-score (Weight: 25%)
    let govScore = 0;
    socScore = 0;
    const traceabilityScores: Record<string, number> = {
      basic: 10,
      gps_tagged: 20,
      iot_sensor_verified: 30,
      blockchain_tokenized: 35,
    };
    govScore += traceabilityScores[answers.traceabilityLevel] ?? 15;
    govScore += answers.clearLandTenureVerified ? 25 : 0;
    govScore += answers.independentQualityAudit ? 20 : 0;
    govScore += answers.antiCorruptionCompliance ? 20 : 0;
    const governanceScore = Math.min(Math.round(govScore * 10) / 10, 100);

    // Composite weighted score: E (40%), S (35%), G (25%)
    const composite =
      environmentalScore * 0.40 +
      socialScore * 0.35 +
      governanceScore * 0.25;

    const esgScore = Math.min(Math.max(Math.round(composite * 10) / 10, 0), 100);
    const esgRating = this.scoreToRating(esgScore);

    const breakdown = {
      environmental: {
        subScore: environmentalScore,
        weight: '40%',
        deforestationFree: answers.deforestationFree,
        waterEfficiency: answers.waterEfficiencyRating,
        organicOrRegenerative: answers.organicOrRegenerativePractices,
        renewableEnergy: answers.renewableEnergyUsagePercent,
      },
      social: {
        subScore: socialScore,
        weight: '35%',
        childLaborSafeguards: answers.childLaborSafeguardsVerified,
        workerSafety: answers.workerSafetyProtocol,
        fairPricePremium: answers.fairPricePremiumPercent,
        inclusionRate: answers.femaleOrYouthFarmerInclusionPercent,
      },
      governance: {
        subScore: governanceScore,
        weight: '25%',
        traceabilityLevel: answers.traceabilityLevel,
        landTenureVerified: answers.clearLandTenureVerified,
        independentAudit: answers.independentQualityAudit,
        antiCorruption: answers.antiCorruptionCompliance,
      },
      certifications: answers.additionalCertifications ?? [],
      submittedNotes: answers.notes,
    };

    return {
      esgScore,
      environmentalScore,
      socialScore,
      governanceScore,
      esgRating,
      breakdown,
    };
  }

  public scoreToRating(score: number): 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'B' | 'CCC' {
    if (score >= 85) return 'AAA';
    if (score >= 75) return 'AA';
    if (score >= 65) return 'A';
    if (score >= 55) return 'BBB';
    if (score >= 45) return 'BB';
    if (score >= 35) return 'B';
    return 'CCC';
  }

  /**
   * Trader/Farmer submits questionnaire at deal creation or edit.
   * Computes provisional score and enters the deal into the admin review queue.
   */
  async submitQuestionnaire(
    dealId: string,
    userId: string,
    answers: EsgQuestionnaireDto,
  ): Promise<TradeDeal> {
    const deal = await this.tradeDealRepo.findOne({ where: { id: dealId } });
    if (!deal) {
      throw new NotFoundException(`Trade deal ${dealId} not found`);
    }

    if (deal.traderId !== userId && deal.farmerId !== userId) {
      throw new ForbiddenException('Only the listing trader or farmer may submit the ESG questionnaire');
    }

    const calculated = this.calculateScore(answers);

    deal.esgScore = calculated.esgScore;
    deal.environmentalScore = calculated.environmentalScore;
    deal.socialScore = calculated.socialScore;
    deal.governanceScore = calculated.governanceScore;
    deal.esgRating = calculated.esgRating;
    deal.esgBreakdown = calculated.breakdown;
    deal.esgStatus = 'pending_review';

    const saved = await this.tradeDealRepo.save(deal);
    this.logger.info(
      { dealId, esgScore: calculated.esgScore, esgRating: calculated.esgRating },
      'ESG questionnaire submitted and queued for review',
    );
    return saved;
  }

  /**
   * Admin reviews and approves/rejects the ESG score, with optional adjustment.
   */
  async reviewScore(
    dealId: string,
    adminId: string,
    approved: boolean,
    notes?: string,
    adjustedScore?: number,
  ): Promise<TradeDeal> {
    const deal = await this.tradeDealRepo.findOne({ where: { id: dealId } });
    if (!deal) {
      throw new NotFoundException(`Trade deal ${dealId} not found`);
    }

    deal.esgStatus = approved ? 'approved' : 'rejected';
    deal.esgReviewedBy = adminId;
    deal.esgReviewedAt = new Date();
    deal.esgReviewNotes = notes ?? null;

    if (approved && adjustedScore !== undefined) {
      deal.esgScore = Math.min(Math.max(adjustedScore, 0), 100);
      deal.esgRating = this.scoreToRating(deal.esgScore);
    }

    const saved = await this.tradeDealRepo.save(deal);
    this.logger.info(
      { dealId, adminId, approved, finalScore: deal.esgScore },
      'ESG review completed',
    );
    return saved;
  }

  /**
   * Retrieves pending ESG reviews for compliance administrators.
   */
  async getPendingReviewDeals(): Promise<TradeDeal[]> {
    return this.tradeDealRepo.find({
      where: { esgStatus: 'pending_review' },
      order: { createdAt: 'DESC' },
      relations: ['farmer', 'trader'],
    });
  }

  /**
   * Retrieves ESG score and breakdown for a specific trade deal.
   */
  async getDealEsgScore(dealId: string) {
    const deal = await this.tradeDealRepo.findOne({
      where: { id: dealId },
      select: [
        'id',
        'commodity',
        'title',
        'esgScore',
        'environmentalScore',
        'socialScore',
        'governanceScore',
        'esgRating',
        'esgBreakdown',
        'esgStatus',
        'esgReviewedAt',
      ],
    });

    if (!deal) {
      throw new NotFoundException(`Trade deal ${dealId} not found`);
    }

    return deal;
  }
}
