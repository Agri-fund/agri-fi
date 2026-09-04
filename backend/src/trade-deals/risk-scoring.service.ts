import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { TradeDeal } from './entities/trade-deal.entity';
import {
  Investment,
  InvestmentStatus,
} from '../investments/entities/investment.entity';
import { User } from '../auth/entities/user.entity';

export interface RiskBreakdown {
  farmerRepayment: number;
  commodityVolatility: number;
  weatherRisk: number;
  dealDuration: number;
  collateralCoverage: number;
}

export interface RiskScoreResult {
  score: number;
  rating: 'Low' | 'Medium' | 'High' | 'Very High';
  breakdown: RiskBreakdown;
}

// Weights must sum to 1.0
const WEIGHTS = {
  farmerRepayment: 0.25,
  commodityVolatility: 0.2,
  weatherRisk: 0.2,
  dealDuration: 0.15,
  collateralCoverage: 0.2,
};

// Commodity volatility baseline (0-100 scale, higher = more volatile)
const COMMODITY_VOLATILITY: Record<string, number> = {
  cocoa: 45,
  coffee: 50,
  maize: 35,
  corn: 35,
  wheat: 40,
  rice: 30,
  soybeans: 42,
  cotton: 38,
  sugar: 55,
  palm_oil: 48,
  tea: 33,
};

// Country weather risk baseline (0-100 scale)
const COUNTRY_WEATHER_RISK: Record<string, number> = {
  GH: 40,
  KE: 50,
  NG: 55,
  TZ: 45,
  UG: 42,
  ET: 60,
  CI: 38,
  SN: 35,
  ML: 55,
  BF: 52,
  ZM: 38,
  MW: 36,
  MZ: 48,
  IN: 58,
  BR: 42,
  VN: 45,
  ID: 50,
  TH: 40,
  MX: 44,
  CO: 46,
};

@Injectable()
export class RiskScoringService {
  constructor(
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RiskScoringService.name);
  }

  async computeScore(dealId: string): Promise<RiskScoreResult> {
    const deal = await this.tradeDealRepo.findOne({
      where: { id: dealId },
      relations: ['farmer'],
    });
    if (!deal) {
      throw new Error(`Trade deal ${dealId} not found`);
    }

    const farmerRepayment = await this.scoreFarmerRepayment(deal.farmerId);
    const commodityVolatility = this.scoreCommodityVolatility(deal.commodity);
    const weatherRisk = this.scoreWeatherRisk(deal.farmer?.country);
    const dealDuration = this.scoreDealDuration(
      deal.deliveryDate,
      deal.createdAt,
    );
    const collateralCoverage = this.scoreCollateralCoverage(deal);

    const breakdown: RiskBreakdown = {
      farmerRepayment,
      commodityVolatility,
      weatherRisk,
      dealDuration,
      collateralCoverage,
    };

    const score =
      farmerRepayment * WEIGHTS.farmerRepayment +
      commodityVolatility * WEIGHTS.commodityVolatility +
      weatherRisk * WEIGHTS.weatherRisk +
      dealDuration * WEIGHTS.dealDuration +
      collateralCoverage * WEIGHTS.collateralCoverage;

    const roundedScore = Math.round(score * 100) / 100;
    const rating = this.scoreToRating(roundedScore);

    this.logger.info(
      { dealId, score: roundedScore, rating },
      'Risk score computed',
    );

    return { score: roundedScore, rating, breakdown };
  }

  async computeAndPersist(dealId: string): Promise<RiskScoreResult> {
    const result = await this.computeScore(dealId);
    await this.tradeDealRepo.update(dealId, {
      riskScore: result.score,
      riskRating: result.rating,
      riskBreakdown: result.breakdown,
    });
    return result;
  }

  async recalculateAll(): Promise<void> {
    const deals = await this.tradeDealRepo.find({
      where: [{ status: 'open' }, { status: 'funded' }],
    });

    this.logger.info(
      `Recalculating risk scores for ${deals.length} active deals`,
    );

    for (const deal of deals) {
      try {
        await this.computeAndPersist(deal.id);
      } catch (err: any) {
        this.logger.error(
          { dealId: deal.id, error: err.message },
          'Failed to recalculate risk score',
        );
      }
    }
  }

  /**
   * Farmer historical repayment score (0-100, higher = riskier).
   * Based on ratio of failed/refunded investments to total.
   */
  private async scoreFarmerRepayment(farmerId: string): Promise<number> {
    const investments = await this.investmentRepo.find({
      where: { tradeDeal: { farmerId } },
    });

    if (investments.length === 0) return 50; // No history = medium risk

    const failedCount = investments.filter(
      (inv) =>
        inv.status === InvestmentStatus.FAILED ||
        inv.status === InvestmentStatus.REFUNDED,
    ).length;

    const failureRate = failedCount / investments.length;
    return Math.min(100, Math.round(failureRate * 100 * 1.5));
  }

  /**
   * Commodity price volatility score (0-100, higher = riskier).
   */
  private scoreCommodityVolatility(commodity: string): number {
    const key = commodity.toLowerCase().replace(/\s+/g, '_');
    return COMMODITY_VOLATILITY[key] ?? 50;
  }

  /**
   * Geographic weather risk score (0-100, higher = riskier).
   */
  private scoreWeatherRisk(country?: string): number {
    if (!country) return 50;
    return COUNTRY_WEATHER_RISK[country.toUpperCase()] ?? 50;
  }

  /**
   * Deal duration risk (0-100, higher = riskier).
   * Longer deals carry more uncertainty.
   */
  private scoreDealDuration(deliveryDate: Date, createdAt: Date): number {
    const now = new Date();
    const delivery = new Date(deliveryDate);
    const created = new Date(createdAt);

    const totalDays = Math.max(
      1,
      Math.ceil(
        (delivery.getTime() - created.getTime()) / (1000 * 60 * 60 * 24),
      ),
    );

    // <30 days = low risk, 30-90 = medium, 90-180 = high, >180 = very high
    if (totalDays <= 30) return 15;
    if (totalDays <= 90) return 35;
    if (totalDays <= 180) return 60;
    return 85;
  }

  /**
   * Collateral coverage score (0-100, higher = riskier).
   * Based on funding progress and token coverage.
   */
  private scoreCollateralCoverage(deal: TradeDeal): number {
    const totalValue = Number(deal.totalValue);
    const totalInvested = Number(deal.totalInvested);

    if (totalValue <= 0) return 80;

    const fundingRatio = totalInvested / totalValue;

    // Higher funding = lower risk
    if (fundingRatio >= 0.9) return 10;
    if (fundingRatio >= 0.7) return 25;
    if (fundingRatio >= 0.5) return 45;
    if (fundingRatio >= 0.25) return 65;
    return 85;
  }

  private scoreToRating(
    score: number,
  ): 'Low' | 'Medium' | 'High' | 'Very High' {
    if (score <= 25) return 'Low';
    if (score <= 50) return 'Medium';
    if (score <= 75) return 'High';
    return 'Very High';
  }
}
