import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TradeDeal } from './entities/trade-deal.entity';
import {
  Investment,
  InvestmentStatus,
} from '../investments/entities/investment.entity';
import {
  ShipmentMilestone,
  MilestoneType,
} from '../shipments/entities/shipment-milestone.entity';
import { RiskScoringService } from './risk-scoring.service';

export type DealHealthStatus = 'Healthy' | 'Warning' | 'At-risk';

export interface DealHealthSnapshot {
  dealId: string;
  riskScore: number;
  riskRating: 'Low' | 'Medium' | 'High' | 'Very High';
  status: DealHealthStatus;
  funding: {
    raisedPct: number;
    expectedPctByNow: number;
    totalValue: number;
    totalInvested: number;
    daysRemaining: number;
    timeline: { date: string; raisedPct: number }[];
  };
  milestones: {
    completedCount: number;
    expectedCountByNow: number;
    totalCount: number;
    timeline: { date: string; completedCount: number }[];
  };
  computedAt: string;
}

/** Ordered logistics pipeline a deal's shipment progresses through. */
const MILESTONE_SEQUENCE: MilestoneType[] = [
  'farm',
  'warehouse',
  'port',
  'importer',
];

/** Investment statuses that count as money actually raised. */
const RAISED_STATUSES = [
  InvestmentStatus.CONFIRMED,
  InvestmentStatus.ACTIVE,
  InvestmentStatus.RELEASING,
  InvestmentStatus.COMPLETED,
];

// ── Status thresholds ───────────────────────────────────────────────────────
// The first three constants are copied verbatim from
// `deal-health-monitor.service.ts` so that the "At-risk" pill agrees with the
// conditions that already fire a real DealHealthAlert for this deal, rather
// than introducing a second, disconnected set of numbers.
const FUNDING_LOW_THRESHOLD = 30; // checkFundingBelowThreshold
const FUNDING_LOW_DAYS_REMAINING = 7; // checkFundingBelowThreshold
const SHIPMENT_OVERDUE_HOURS = 24; // checkShipmentOverdue

// The monitor only has a binary alert/no-alert signal, so it has no
// equivalent of a "Warning" tier. These thresholds are new, chosen so that
// "Warning" sits strictly between Healthy and the At-risk gap above:
// half the gap (15pts / 1 milestone) is a mild pace slip worth surfacing,
// double the gap (30pts / 2 milestones) is treated as severe (At-risk).
const FUNDING_PACE_WARNING_GAP_PCT = 15;
const FUNDING_PACE_AT_RISK_GAP_PCT = 30;
const MILESTONE_WARNING_GAP = 1;
const MILESTONE_AT_RISK_GAP = 2;

@Injectable()
export class DealHealthService {
  constructor(
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(ShipmentMilestone)
    private readonly milestoneRepo: Repository<ShipmentMilestone>,
    private readonly riskScoringService: RiskScoringService,
  ) {}

  /**
   * Composes a point-in-time health snapshot for a single deal: risk score
   * (from RiskScoringService), funding raised vs. expected pace, and
   * milestone completion vs. expected schedule, plus a derived
   * Healthy / Warning / At-risk status pill.
   */
  async getDealHealth(dealId: string): Promise<DealHealthSnapshot> {
    const deal = await this.tradeDealRepo.findOne({ where: { id: dealId } });
    if (!deal) {
      throw new NotFoundException(`Trade deal ${dealId} not found`);
    }

    const [riskResult, investments, milestoneRecords] = await Promise.all([
      this.riskScoringService.computeScore(dealId),
      this.investmentRepo.find({
        where: { tradeDealId: dealId },
        order: { createdAt: 'ASC' },
      }),
      this.milestoneRepo.find({
        where: { tradeDealId: dealId },
        order: { recordedAt: 'ASC' },
      }),
    ]);

    const funding = this.computeFundingHealth(deal, investments);
    const milestones = this.computeMilestoneHealth(deal, milestoneRecords);
    const status = this.determineStatus(
      deal,
      riskResult.rating,
      funding,
      milestones,
    );

    return {
      dealId,
      riskScore: riskResult.score,
      riskRating: riskResult.rating,
      status,
      funding,
      milestones,
      computedAt: new Date().toISOString(),
    };
  }

  private computeFundingHealth(
    deal: TradeDeal,
    investments: Investment[],
  ): DealHealthSnapshot['funding'] {
    const totalValue = Number(deal.totalValue);
    const totalInvested = Number(deal.totalInvested);
    const raisedPct =
      totalValue > 0
        ? Math.min(100, Math.round((totalInvested / totalValue) * 1000) / 10)
        : 0;

    const { elapsedFraction, daysRemaining } = this.computeTimelineProgress(
      deal,
    );
    const expectedPctByNow =
      Math.round(Math.min(1, elapsedFraction) * 1000) / 10;

    // Build a cumulative funding-over-time series from raised investments.
    const raisedOnly = investments.filter((inv) =>
      RAISED_STATUSES.includes(inv.status),
    );
    let cumulative = 0;
    const timeline = raisedOnly.map((inv) => {
      cumulative += Number(inv.amountUsd);
      const pct =
        totalValue > 0
          ? Math.min(100, Math.round((cumulative / totalValue) * 1000) / 10)
          : 0;
      return {
        date: new Date(inv.createdAt).toISOString(),
        raisedPct: pct,
      };
    });

    if (timeline.length === 0) {
      timeline.push({
        date: new Date(deal.createdAt).toISOString(),
        raisedPct: 0,
      });
    }

    return {
      raisedPct,
      expectedPctByNow,
      totalValue,
      totalInvested,
      daysRemaining,
      timeline,
    };
  }

  private computeMilestoneHealth(
    deal: TradeDeal,
    milestoneRecords: ShipmentMilestone[],
  ): DealHealthSnapshot['milestones'] {
    const { elapsedFraction } = this.computeTimelineProgress(deal);
    const totalCount = MILESTONE_SEQUENCE.length;
    const expectedCountByNow = Math.round(
      Math.min(1, elapsedFraction) * totalCount,
    );

    const completedTypes = new Set<MilestoneType>();
    const timeline: { date: string; completedCount: number }[] = [];

    for (const record of milestoneRecords) {
      if (!completedTypes.has(record.milestone)) {
        completedTypes.add(record.milestone);
        timeline.push({
          date: new Date(record.recordedAt).toISOString(),
          completedCount: completedTypes.size,
        });
      }
    }

    if (timeline.length === 0) {
      timeline.push({
        date: new Date(deal.createdAt).toISOString(),
        completedCount: 0,
      });
    }

    return {
      completedCount: completedTypes.size,
      expectedCountByNow,
      totalCount,
      timeline,
    };
  }

  /**
   * Fraction of the deal's overall timeline (creation -> delivery date) that
   * has elapsed so far, plus days remaining until delivery. Mirrors the day
   * math used by RiskScoringService.scoreDealDuration and
   * DealHealthMonitorService.getDaysUntilDelivery.
   */
  private computeTimelineProgress(deal: TradeDeal): {
    elapsedFraction: number;
    daysRemaining: number;
  } {
    const created = new Date(deal.createdAt);
    const delivery = new Date(deal.deliveryDate);
    const now = new Date();

    const totalDays =
      deal.durationDays && deal.durationDays > 0
        ? deal.durationDays
        : Math.max(
            1,
            Math.ceil(
              (delivery.getTime() - created.getTime()) / (1000 * 60 * 60 * 24),
            ),
          );

    const elapsedDays = Math.max(
      0,
      (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24),
    );

    const elapsedFraction = Math.max(0, elapsedDays / totalDays);

    const daysRemaining = Math.ceil(
      (delivery.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    return { elapsedFraction, daysRemaining };
  }

  private isShipmentOverdue(deal: TradeDeal): boolean {
    if (deal.status !== 'funded') return false;

    const deliveryDate = new Date(deal.deliveryDate);
    const overdueThreshold = new Date();
    overdueThreshold.setHours(
      overdueThreshold.getHours() - SHIPMENT_OVERDUE_HOURS,
    );

    return deliveryDate < overdueThreshold;
  }

  private determineStatus(
    deal: TradeDeal,
    riskRating: 'Low' | 'Medium' | 'High' | 'Very High',
    funding: DealHealthSnapshot['funding'],
    milestones: DealHealthSnapshot['milestones'],
  ): DealHealthStatus {
    const criticalFundingGap =
      funding.raisedPct < FUNDING_LOW_THRESHOLD &&
      funding.daysRemaining <= FUNDING_LOW_DAYS_REMAINING;
    const fundingPaceGap = funding.expectedPctByNow - funding.raisedPct;
    const milestoneGap = milestones.expectedCountByNow - milestones.completedCount;

    if (
      this.isShipmentOverdue(deal) ||
      criticalFundingGap ||
      riskRating === 'Very High' ||
      fundingPaceGap >= FUNDING_PACE_AT_RISK_GAP_PCT ||
      milestoneGap >= MILESTONE_AT_RISK_GAP
    ) {
      return 'At-risk';
    }

    if (
      riskRating === 'High' ||
      fundingPaceGap >= FUNDING_PACE_WARNING_GAP_PCT ||
      milestoneGap >= MILESTONE_WARNING_GAP
    ) {
      return 'Warning';
    }

    return 'Healthy';
  }
}
