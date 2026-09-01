import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { FarmerCreditScoreHistory } from './entities/farmer-credit-score-history.entity';

export interface ScoreFactorsInput {
  onTimeRepaymentRate: number; // 0.0 to 1.0 (weight 35%)
  dealCompletionRate: number; // 0.0 to 1.0 (weight 20%)
  dealDefaultRate: number; // 0.0 to 1.0 (weight 20% - inverted)
  shipmentMilestoneComplianceRate: number; // 0.0 to 1.0 (weight 15%)
  kycVerificationAgeDays: number; // days since verified, normalized up to 365 (weight 10%)
}

@Injectable()
export class FarmerCreditScoringService {
  private readonly logger = new Logger(FarmerCreditScoringService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(FarmerCreditScoreHistory)
    private readonly historyRepository: Repository<FarmerCreditScoreHistory>,
  ) {}

  public calculateScoreFromFactors(factors: ScoreFactorsInput): number {
    const repaymentComponent =
      Math.min(Math.max(factors.onTimeRepaymentRate, 0), 1) * 0.35;
    const completionComponent =
      Math.min(Math.max(factors.dealCompletionRate, 0), 1) * 0.2;
    const defaultInverted = Math.max(
      0,
      1 - Math.min(Math.max(factors.dealDefaultRate, 0), 1),
    );
    const defaultComponent = defaultInverted * 0.2;
    const milestoneComponent =
      Math.min(Math.max(factors.shipmentMilestoneComplianceRate, 0), 1) * 0.15;

    // Normalize KYC age: 365 days or more gives full 1.0
    const kycNormalized = Math.min(
      Math.max(factors.kycVerificationAgeDays, 0) / 365,
      1,
    );
    const kycComponent = kycNormalized * 0.1;

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

    return await this.historyRepository.save(history);
  }
}
