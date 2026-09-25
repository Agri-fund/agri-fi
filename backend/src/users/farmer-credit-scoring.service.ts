import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  Inject,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { User } from '../auth/entities/user.entity';
import { FarmerCreditScoreHistory } from './entities/farmer-credit-score-history.entity';

export interface ScoreFactorsInput {
  onTimeRepaymentRate: number; // 0.0 to 1.0 (weight 35%)
  dealCompletionRate: number; // 0.0 to 1.0 (weight 20%)
  dealDefaultRate: number; // 0.0 to 1.0 (weight 20% - inverted)
  shipmentMilestoneComplianceRate: number; // 0.0 to 1.0 (weight 15%)
  kycVerificationAgeDays: number; // days since verified, normalized up to 365 (weight 10%)
}

export interface FactorBreakdownItem {
  name: string;
  weight: number;
  weightPercent: string;
  scorePercent: number;
  description: string;
  impact: 'positive' | 'neutral' | 'negative';
}

export interface CreditScoreDisclosure {
  score: number;
  tier: 'Excellent' | 'Good' | 'Fair' | 'Poor';
  maxDealSizeUsdc: number;
  factors: ScoreFactorsInput;
  breakdown: Record<string, FactorBreakdownItem>;
  tips: string[];
  lastUpdated: string;
  cached: boolean;
}

export const FACTOR_WEIGHTS = {
  onTimeRepayment: 0.35,
  dealCompletion: 0.20,
  defaultRate: 0.20,
  shipmentMilestone: 0.15,
  kycAge: 0.10,
};

const CREDIT_SCORE_CACHE_TTL_MS = 15 * 60 * 1_000; // 15-minute TTL

@Injectable()
export class FarmerCreditScoringService {
  private readonly logger = new Logger(FarmerCreditScoringService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(FarmerCreditScoreHistory)
    private readonly historyRepository: Repository<FarmerCreditScoreHistory>,
    @Optional()
    @Inject(CACHE_MANAGER)
    private readonly cacheManager?: Cache,
  ) {}

  public calculateScoreFromFactors(factors: ScoreFactorsInput): number {
    const repaymentComponent =
      Math.min(Math.max(factors.onTimeRepaymentRate, 0), 1) * FACTOR_WEIGHTS.onTimeRepayment;
    const completionComponent =
      Math.min(Math.max(factors.dealCompletionRate, 0), 1) * FACTOR_WEIGHTS.dealCompletion;
    const defaultInverted = Math.max(
      0,
      1 - Math.min(Math.max(factors.dealDefaultRate, 0), 1),
    );
    const defaultComponent = defaultInverted * FACTOR_WEIGHTS.defaultRate;
    const milestoneComponent =
      Math.min(Math.max(factors.shipmentMilestoneComplianceRate, 0), 1) * FACTOR_WEIGHTS.shipmentMilestone;

    // Normalize KYC age: 365 days or more gives full 1.0
    const kycNormalized = Math.min(
      Math.max(factors.kycVerificationAgeDays, 0) / 365,
      1,
    );
    const kycComponent = kycNormalized * FACTOR_WEIGHTS.kycAge;

    const weightedScore =
      repaymentComponent +
      completionComponent +
      defaultComponent +
      milestoneComponent +
      kycComponent;

    // Scale to FICO range: 300 to 850 (span 550)
    const score = Math.round(300 + weightedScore * 550);
    return Math.min(Math.max(score, 300), 850);
  }

  public deriveMaxDealSize(score: number): number {
    if (score < 500) {
      return 10000; // $10K
    } else if (score < 700) {
      return 50000; // $50K
    } else {
      return 200000; // $200K
    }
  }

  public deriveScoreTier(score: number): 'Excellent' | 'Good' | 'Fair' | 'Poor' {
    if (score >= 750) return 'Excellent';
    if (score >= 670) return 'Good';
    if (score >= 580) return 'Fair';
    return 'Poor';
  }

  public generateTips(factors: ScoreFactorsInput, score: number): string[] {
    const tips: string[] = [];

    if (factors.onTimeRepaymentRate < 0.95) {
      tips.push(
        'Maintain on-time delivery across upcoming harvest cycles. On-time delivery carries the highest weight (35%) in your score.',
      );
    }
    if (factors.shipmentMilestoneComplianceRate < 0.90) {
      tips.push(
        'Log shipment checkpoints and keep IoT sensor telemetry active. Regular milestone updates account for 15% of your score.',
      );
    }
    if (factors.dealDefaultRate > 0) {
      tips.push(
        'Avoid cancelled or unfulfilled deals. Zero defaults protect 20% of your total credit rating.',
      );
    }
    if (factors.dealCompletionRate < 0.90) {
      tips.push(
        'Complete your active listed crops through final escrow release to build a solid track record (20% weight).',
      );
    }
    if (factors.kycVerificationAgeDays < 180) {
      tips.push(
        'Keep your farm registry and KYC documentation verified and up to date (10% weight).',
      );
    }

    if (tips.length === 0 || score >= 750) {
      tips.unshift(
        'Your profile is in the top tier! You qualify for the lowest platform financing fees and up to $200,000 in uncollateralized deal limits.',
      );
    }

    return tips;
  }

  /**
   * Discloses the farmer's credit score, detailed weighted factor breakdown,
   * loan pricing tier, and personalized improvement tips.
   * Utilizes a 15-minute Redis cache.
   */
  async getCreditScoreDisclosure(userId: string): Promise<CreditScoreDisclosure> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (user.role !== 'farmer' && user.role !== 'admin') {
      throw new ForbiddenException(
        'Farmer credit score disclosure is only available for farmer accounts.',
      );
    }

    const cacheKey = `farmer:credit-score:${userId}`;

    if (this.cacheManager) {
      try {
        const cached = await this.cacheManager.get<CreditScoreDisclosure>(cacheKey);
        if (cached) {
          return { ...cached, cached: true };
        }
      } catch (err: any) {
        this.logger.warn(`Redis get failed for ${cacheKey}: ${err.message}`);
      }
    }

    // Retrieve latest score calculation or calculate default baseline
    const latestHistory = await this.historyRepository.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    const factors: ScoreFactorsInput = latestHistory?.factors ?? {
      onTimeRepaymentRate: 0.95,
      dealCompletionRate: 0.90,
      dealDefaultRate: 0.02,
      shipmentMilestoneComplianceRate: 0.92,
      kycVerificationAgeDays: 180,
    };

    const score = user.creditScore ?? this.calculateScoreFromFactors(factors);
    const maxDealSizeUsdc = this.deriveMaxDealSize(score);
    const tier = this.deriveScoreTier(score);
    const tips = this.generateTips(factors, score);

    const breakdown: Record<string, FactorBreakdownItem> = {
      onTimeRepayment: {
        name: 'On-Time Repayment & Delivery',
        weight: FACTOR_WEIGHTS.onTimeRepayment,
        weightPercent: '35%',
        scorePercent: Math.round(factors.onTimeRepaymentRate * 100),
        description: 'Track record of on-time crop deliveries against contractual dates.',
        impact: factors.onTimeRepaymentRate >= 0.9 ? 'positive' : 'negative',
      },
      dealCompletion: {
        name: 'Deal Completion Rate',
        weight: FACTOR_WEIGHTS.dealCompletion,
        weightPercent: '20%',
        scorePercent: Math.round(factors.dealCompletionRate * 100),
        description: 'Ratio of trade deals successfully carried through to settlement.',
        impact: factors.dealCompletionRate >= 0.85 ? 'positive' : 'neutral',
      },
      lowDefaultRate: {
        name: 'Low Default & Cancellation Rate',
        weight: FACTOR_WEIGHTS.defaultRate,
        weightPercent: '20%',
        scorePercent: Math.round((1 - factors.dealDefaultRate) * 100),
        description: 'Absence of abandoned contracts, disputes, or buyer defaults.',
        impact: factors.dealDefaultRate === 0 ? 'positive' : 'negative',
      },
      sensorMilestoneCompliance: {
        name: 'Shipment Milestones & IoT Uptime',
        weight: FACTOR_WEIGHTS.shipmentMilestone,
        weightPercent: '15%',
        scorePercent: Math.round(factors.shipmentMilestoneComplianceRate * 100),
        description: 'Prompt milestone check-ins and IoT telemetry transmission.',
        impact: factors.shipmentMilestoneComplianceRate >= 0.9 ? 'positive' : 'neutral',
      },
      kycAge: {
        name: 'KYC & Farm Verification Longevity',
        weight: FACTOR_WEIGHTS.kycAge,
        weightPercent: '10%',
        scorePercent: Math.min(Math.round((factors.kycVerificationAgeDays / 365) * 100), 100),
        description: 'Tenure of active identity and agricultural verification.',
        impact: factors.kycVerificationAgeDays >= 180 ? 'positive' : 'neutral',
      },
    };

    const disclosure: CreditScoreDisclosure = {
      score,
      tier,
      maxDealSizeUsdc,
      factors,
      breakdown,
      tips,
      lastUpdated: (latestHistory?.createdAt ?? user.createdAt ?? new Date()).toISOString(),
      cached: false,
    };

    if (this.cacheManager) {
      try {
        await this.cacheManager.set(cacheKey, disclosure, CREDIT_SCORE_CACHE_TTL_MS);
      } catch (err: any) {
        this.logger.warn(`Redis set failed for ${cacheKey}: ${err.message}`);
      }
    }

    return disclosure;
  }

  async computeScore(
    userId: string,
    reason: string = 'Periodic recalculation',
    customFactors?: ScoreFactorsInput,
  ): Promise<{
    score: number;
    maxDealSizeUsdc: number;
    factors: ScoreFactorsInput;
  }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const factors: ScoreFactorsInput = customFactors || {
      onTimeRepaymentRate: 0.95,
      dealCompletionRate: 0.9,
      dealDefaultRate: 0.02,
      shipmentMilestoneComplianceRate: 0.92,
      kycVerificationAgeDays: 180,
    };

    const score = this.calculateScoreFromFactors(factors);
    const maxDealSizeUsdc = this.deriveMaxDealSize(score);

    // Save to user profile
    user.creditScore = score;
    await this.userRepository.save(user);

    // Save to history audit table
    const history = this.historyRepository.create({
      userId,
      score,
      maxDealSizeUsdc,
      factors,
      reason,
      overrideBy: null,
    });
    await this.historyRepository.save(history);

    // Invalidate Redis cache
    if (this.cacheManager) {
      try {
        await this.cacheManager.del(`farmer:credit-score:${userId}`);
      } catch {}
    }

    this.logger.log(
      `Credit score updated for user ${userId}: ${score} (Tier max: $${maxDealSizeUsdc})`,
    );

    return { score, maxDealSizeUsdc, factors };
  }

  async manualOverride(
    adminId: string,
    userId: string,
    score: number,
    reason: string,
  ): Promise<FarmerCreditScoreHistory> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const boundedScore = Math.min(Math.max(score, 300), 850);
    const maxDealSizeUsdc = this.deriveMaxDealSize(boundedScore);

    user.creditScore = boundedScore;
    await this.userRepository.save(user);

    const history = this.historyRepository.create({
      userId,
      score: boundedScore,
      maxDealSizeUsdc,
      factors: {
        onTimeRepaymentRate: 1,
        dealCompletionRate: 1,
        dealDefaultRate: 0,
        shipmentMilestoneComplianceRate: 1,
        kycVerificationAgeDays: 365,
      },
      reason: `Admin override by ${adminId}: ${reason}`,
      overrideBy: adminId,
    });

    const saved = await this.historyRepository.save(history);

    // Invalidate Redis cache
    if (this.cacheManager) {
      try {
        await this.cacheManager.del(`farmer:credit-score:${userId}`);
      } catch {}
    }

    return saved;
  }
}
