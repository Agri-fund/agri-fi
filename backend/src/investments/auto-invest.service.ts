import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, Between } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import {
  AutoInvestPlan,
  AutoInvestCadence,
  AutoInvestPlanVersion,
} from './entities/auto-invest-plan.entity';
import {
  CreateAutoInvestPlanDto,
  UpdateAutoInvestPlanDto,
} from './dto/auto-invest-plan.dto';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { RiskScoringService } from '../trade-deals/risk-scoring.service';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../auth/entities/user.entity';

/** How many open deals to evaluate per plan run (prevents runaway scans) */
const MAX_DEALS_TO_EVALUATE = 20;
const MAX_BACKTEST_DEALS = 2000;

const STRATEGY_TEMPLATES = [
  {
    id: 'africa-growth',
    name: 'Africa growth',
    description: 'Higher expected ROI deals located in Africa with a moderate risk ceiling.',
    minimumExpectedRoi: 15,
    regionFilter: ['Africa'],
    maxRiskScore: 65,
  },
  {
    id: 'capital-preservation',
    name: 'Capital preservation',
    description: 'Lower-risk deals with a shorter duration and broad commodity coverage.',
    minimumExpectedRoi: 5,
    maxRiskScore: 35,
    maxDurationDays: 180,
  },
  {
    id: 'cocoa-income',
    name: 'Cocoa income',
    description: 'Cocoa deals with a minimum expected return and a capped position size.',
    minimumExpectedRoi: 10,
    maxRiskScore: 60,
    dealTypeFilter: ['cocoa'],
    maxPositionUsd: 1000,
  },
];

function strategySnapshot(plan: AutoInvestPlan): Record<string, unknown> {
  return {
    name: plan.name,
    amountUsd: plan.amountUsd,
    cadence: plan.cadence,
    maxRiskScore: plan.maxRiskScore,
    dealTypeFilter: plan.dealTypeFilter,
    minimumExpectedRoi: plan.minimumExpectedRoi,
    regionFilter: plan.regionFilter,
    maxDurationDays: plan.maxDurationDays,
    maxPositionUsd: plan.maxPositionUsd,
    dailyCapUsd: plan.dailyCapUsd,
    isPublic: plan.isPublic,
  };
}

function matchesPlanCriteria(plan: AutoInvestPlan, deal: TradeDeal): boolean {
  if (
    plan.dealTypeFilter?.length &&
    !plan.dealTypeFilter.some(
      (commodity) => commodity.toLowerCase() === deal.commodity.toLowerCase(),
    )
  ) {
    return false;
  }

  if (
    plan.minimumExpectedRoi !== null &&
    plan.minimumExpectedRoi !== undefined &&
    (deal.expectedRoi === null ||
      deal.expectedRoi === undefined ||
      Number(deal.expectedRoi) < Number(plan.minimumExpectedRoi))
  ) {
    return false;
  }

  if (
    plan.maxDurationDays !== null &&
    plan.maxDurationDays !== undefined &&
    (deal.durationDays === null ||
      deal.durationDays === undefined ||
      deal.durationDays > plan.maxDurationDays)
  ) {
    return false;
  }

  if (plan.regionFilter?.length) {
    const location = (deal.farmLocation ?? '').toLowerCase();
    if (!plan.regionFilter.some((region) => location.includes(region.toLowerCase()))) {
      return false;
    }
  }

  return true;
}

function addCadenceDays(date: Date, cadence: AutoInvestCadence): Date {
  const result = new Date(date);
  if (cadence === 'weekly') result.setDate(result.getDate() + 7);
  else if (cadence === 'biweekly') result.setDate(result.getDate() + 14);
  else result.setMonth(result.getMonth() + 1);
  return result;
}

@Injectable()
export class AutoInvestService {
  constructor(
    @InjectRepository(AutoInvestPlan)
    private readonly planRepo: Repository<AutoInvestPlan>,
    @InjectRepository(TradeDeal)
    private readonly dealRepo: Repository<TradeDeal>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly riskScoringService: RiskScoringService,
    private readonly notificationsService: NotificationsService,
    private readonly logger: PinoLogger,
  ) {
    (this.logger as any).setContext(AutoInvestService.name);
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async createPlan(
    investorId: string,
    dto: CreateAutoInvestPlanDto,
  ): Promise<AutoInvestPlan> {
    // Verify investor exists and is KYC'd
    const investor = await this.userRepo.findOne({
      where: { id: investorId },
      select: ['id', 'kycStatus', 'role'],
    });
    if (!investor) throw new NotFoundException('Investor not found.');
    if (investor.role !== 'investor') {
      throw new ForbiddenException('Only investors can create auto-invest plans.');
    }
    if (investor.kycStatus !== 'verified') {
      throw new ForbiddenException('KYC must be verified before creating an auto-invest plan.');
    }

    const plan = this.planRepo.create({
      investorId,
      name: dto.name?.trim() || 'Auto-invest strategy',
      amountUsd: dto.amountUsd,
      cadence: dto.cadence,
      fundingWallet: dto.fundingWallet,
      maxRiskScore: dto.maxRiskScore ?? 75,
      dealTypeFilter: dto.dealTypeFilter ?? null,
      minimumExpectedRoi: dto.minimumExpectedRoi ?? null,
      regionFilter: dto.regionFilter ?? null,
      maxDurationDays: dto.maxDurationDays ?? null,
      maxPositionUsd: dto.maxPositionUsd ?? null,
      isPublic: false,
      version: 1,
      versionHistory: [],
      dailyCapUsd: dto.dailyCapUsd ?? null,
      status: 'active',
      consecutiveFailures: 0,
      // First run scheduled for one cadence period from now
      nextRunAt: addCadenceDays(new Date(), dto.cadence),
      lastRunAt: null,
    });

    const saved = await this.planRepo.save(plan);
    this.logger.info({ planId: saved.id, investorId }, 'Auto-invest plan created');
    return saved;
  }

  async findByInvestor(investorId: string): Promise<AutoInvestPlan[]> {
    return this.planRepo.find({
      where: { investorId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(planId: string, investorId: string): Promise<AutoInvestPlan> {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Auto-invest plan not found.');
    if (plan.investorId !== investorId)
      throw new ForbiddenException('You do not own this plan.');
    return plan;
  }

  async updatePlan(
    planId: string,
    investorId: string,
    dto: UpdateAutoInvestPlanDto,
  ): Promise<AutoInvestPlan> {
    const plan = await this.findOne(planId, investorId);
    if (plan.status === 'cancelled') {
      throw new ConflictException('Cannot update a cancelled plan.');
    }

    if (Object.keys(dto).length > 0) {
      const history: AutoInvestPlanVersion[] = plan.versionHistory ?? [];
      history.push({
        version: plan.version,
        snapshot: strategySnapshot(plan),
        createdAt: new Date().toISOString(),
      });
      plan.versionHistory = history;
      plan.version += 1;
    }

    if (dto.name !== undefined) plan.name = dto.name.trim();
    if (dto.amountUsd !== undefined) plan.amountUsd = dto.amountUsd;
    if (dto.cadence !== undefined) plan.cadence = dto.cadence;
    if (dto.fundingWallet !== undefined) plan.fundingWallet = dto.fundingWallet;
    if (dto.maxRiskScore !== undefined) plan.maxRiskScore = dto.maxRiskScore;
    if (dto.dealTypeFilter !== undefined) plan.dealTypeFilter = dto.dealTypeFilter ?? null;
    if (dto.dailyCapUsd !== undefined) plan.dailyCapUsd = dto.dailyCapUsd ?? null;
    if (dto.minimumExpectedRoi !== undefined) plan.minimumExpectedRoi = dto.minimumExpectedRoi ?? null;
    if (dto.regionFilter !== undefined) plan.regionFilter = dto.regionFilter ?? null;
    if (dto.maxDurationDays !== undefined) plan.maxDurationDays = dto.maxDurationDays ?? null;
    if (dto.maxPositionUsd !== undefined) plan.maxPositionUsd = dto.maxPositionUsd ?? null;
    if (dto.isPublic !== undefined) plan.isPublic = dto.isPublic;

    return this.planRepo.save(plan);
  }

  async listCommunityStrategies(): Promise<Array<Record<string, unknown>>> {
    const plans = await this.planRepo.find({
      where: { status: 'active', isPublic: true },
      order: { updatedAt: 'DESC' },
      take: 100,
    });

    return plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      version: plan.version,
      maxRiskScore: plan.maxRiskScore,
      dealTypeFilter: plan.dealTypeFilter,
      minimumExpectedRoi: plan.minimumExpectedRoi,
      regionFilter: plan.regionFilter,
      maxDurationDays: plan.maxDurationDays,
      maxPositionUsd: plan.maxPositionUsd,
      updatedAt: plan.updatedAt,
    }));
  }

  listStrategyTemplates() {
    return STRATEGY_TEMPLATES;
  }

  async getPlanVersions(planId: string, investorId: string) {
    const plan = await this.findOne(planId, investorId);
    return {
      currentVersion: plan.version,
      current: strategySnapshot(plan),
      history: plan.versionHistory ?? [],
    };
  }

  async backtestPlan(
    planId: string,
    investorId: string,
    from: string,
    to: string,
  ) {
    const plan = await this.findOne(planId, investorId);
    const start = new Date(from);
    const end = new Date(to);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
      throw new BadRequestException('Backtest dates must be valid and the start must be before the end.');
    }

    const deals = await this.dealRepo.find({
      where: { createdAt: Between(start, end) },
      order: { createdAt: 'ASC' },
      take: MAX_BACKTEST_DEALS,
    });
    const candidates = deals.filter((deal) => matchesPlanCriteria(plan, deal));
    const eligible = candidates.filter((deal) => {
      return deal.riskScore !== null &&
        deal.riskScore !== undefined &&
        Number(deal.riskScore) <= Number(plan.maxRiskScore);
    });
    const roiValues = eligible
      .map((deal) => deal.expectedRoi)
      .filter((roi): roi is number => roi !== null && roi !== undefined)
      .map(Number);

    return {
      from: start.toISOString(),
      to: end.toISOString(),
      historicalDealsScanned: deals.length,
      matchedDeals: eligible.length,
      averageExpectedRoiPct: roiValues.length
        ? roiValues.reduce((sum, roi) => sum + roi, 0) / roiValues.length
        : null,
      realizedWinRatePct: null,
      maxDrawdownPct: null,
      realizedReturnsAvailable: false,
      capped: deals.length === MAX_BACKTEST_DEALS,
    };
  }

  async pausePlan(planId: string, investorId: string, paused: boolean): Promise<AutoInvestPlan> {
    const plan = await this.findOne(planId, investorId);
    if (plan.status === 'cancelled') {
      throw new ConflictException('Cannot modify a cancelled plan.');
    }
    plan.status = paused ? 'paused' : 'active';
    if (!paused) {
      // Reset failure counter when investor manually resumes
      plan.consecutiveFailures = 0;
    }
    return this.planRepo.save(plan);
  }

  async cancelPlan(planId: string, investorId: string): Promise<AutoInvestPlan> {
    const plan = await this.findOne(planId, investorId);
    plan.status = 'cancelled';
    const saved = await this.planRepo.save(plan);
    await this.planRepo.softDelete(planId);
    return saved;
  }

  // ─── Admin endpoints ───────────────────────────────────────────────────────

  async adminListPlans(
    page = 1,
    limit = 20,
  ): Promise<{ plans: AutoInvestPlan[]; total: number }> {
    const [plans, total] = await this.planRepo.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { plans, total };
  }

  // ─── Cron allocation pipeline ──────────────────────────────────────────────

  /**
  * Runs every 30 minutes. Evaluates active plans whose next_run_at has
  * elapsed and alerts investors about the best-fit open deal. Settlement
  * requires an investor-signed transaction in the existing investment flow.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async runAllocationCycle(): Promise<void> {
    const now = new Date();

    const duePlans = await this.planRepo.find({
      where: {
        status: 'active',
        nextRunAt: LessThanOrEqual(now),
      },
    });

    if (!duePlans.length) {
      this.logger.debug('Auto-invest cron: no plans due');
      return;
    }

    this.logger.info(
      { count: duePlans.length },
      'Auto-invest cron: processing due plans',
    );

    for (const plan of duePlans) {
      try {
        await this.executePlan(plan, now);
      } catch (err: any) {
        this.logger.error(
          { planId: plan.id, error: err.message },
          'Auto-invest plan execution failed',
        );
      }
    }
  }

  private async executePlan(plan: AutoInvestPlan, now: Date): Promise<void> {
    const amountUsd = Number(plan.amountUsd);
    const maxRiskScore = Number(plan.maxRiskScore);

    // ── Select eligible deals ──────────────────────────────────────────────
    const candidateDeals = await this.dealRepo.find({
      where: { status: 'open' },
      order: { createdAt: 'DESC' },
      take: MAX_DEALS_TO_EVALUATE,
    });

    if (!candidateDeals.length) {
      this.logger.info({ planId: plan.id }, 'Auto-invest: no open deals available');
      await this.notifyInvestor(plan, 'skipped_no_deals');
      await this.advancePlanSchedule(plan, now);
      return;
    }

    // ── Risk-score and filter deals ────────────────────────────────────────
    const eligibleDeals: Array<{ deal: TradeDeal; score: number }> = [];

    for (const deal of candidateDeals) {
      // Apply commodity filter
      if (!matchesPlanCriteria(plan, deal)) {
        continue;
      }

      try {
        let score: number;
        if (deal.riskScore !== null && deal.riskScore !== undefined) {
          score = Number(deal.riskScore);
        } else {
          const result = await this.riskScoringService.computeScore(deal.id);
          score = result.score;
        }

        if (score <= maxRiskScore) {
          // Ensure there's capacity remaining
          const remaining = Number(deal.totalValue) - Number(deal.totalInvested);
          if (remaining >= 100) {
            eligibleDeals.push({ deal, score });
          }
        }
      } catch (err: any) {
        this.logger.warn(
          { dealId: deal.id, error: err.message },
          'Auto-invest: failed to score deal, skipping',
        );
      }
    }

    if (!eligibleDeals.length) {
      this.logger.info(
        { planId: plan.id },
        'Auto-invest: no eligible deals after filtering',
      );
      await this.notifyInvestor(plan, 'skipped_no_eligible_deals');
      await this.advancePlanSchedule(plan, now);
      return;
    }

    // ── Select best deal: lowest risk score, then most capacity ───────────
    eligibleDeals.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      const capA = Number(a.deal.totalValue) - Number(a.deal.totalInvested);
      const capB = Number(b.deal.totalValue) - Number(b.deal.totalInvested);
      return capB - capA;
    });

    const { deal: selectedDeal } = eligibleDeals[0];

    // ── Compute token amount (clamped to remaining capacity) ──────────────
    const remaining = Number(selectedDeal.totalValue) - Number(selectedDeal.totalInvested);
    const maxPositionUsd = plan.maxPositionUsd
      ? Number(plan.maxPositionUsd)
      : Number.POSITIVE_INFINITY;
    const dailyCapUsd = plan.dailyCapUsd
      ? Number(plan.dailyCapUsd)
      : Number.POSITIVE_INFINITY;
    const effectiveAmount = Math.min(
      amountUsd,
      remaining,
      maxPositionUsd,
      dailyCapUsd,
    );
    const tokenAmount = Math.floor(effectiveAmount / 100);

    if (tokenAmount < 1) {
      this.logger.warn(
        { planId: plan.id, dealId: selectedDeal.id },
        'Auto-invest: effective amount too small for 1 token',
      );
      await this.advancePlanSchedule(plan, now);
      return;
    }

    this.logger.info(
      {
        planId: plan.id,
        dealId: selectedDeal.id,
        tokenAmount,
        amountUsd: tokenAmount * 100,
      },
      'Auto-invest: matched deal requires an investor-signed transaction',
    );
    plan.lastRunAt = now;
    await this.advancePlanSchedule(plan, now);
    await this.notifyInvestor(plan, 'matched_awaiting_signature', {
      dealId: selectedDeal.id,
      tokenAmount,
      amountUsd: tokenAmount * 100,
    });
  }

  private async advancePlanSchedule(plan: AutoInvestPlan, now: Date): Promise<void> {
    plan.nextRunAt = addCadenceDays(now, plan.cadence);
    await this.planRepo.save(plan);
  }

  private async notifyInvestor(
    plan: AutoInvestPlan,
    event:
      | 'matched_awaiting_signature'
      | 'skipped_no_deals'
      | 'skipped_no_eligible_deals',
    meta?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const messages: Record<string, { title: string; message: string }> = {
        matched_awaiting_signature: {
          title: 'Auto-Invest: Deal Matched',
          message: `Deal ${meta?.dealId} matches your plan for ${meta?.tokenAmount} token(s) ($${meta?.amountUsd}). Sign the transaction to invest; funds have not been moved.`,
        },
        skipped_no_deals: {
          title: 'Auto-Invest: No Open Deals',
          message: 'Your auto-invest plan ran but found no open deals to invest in.',
        },
        skipped_no_eligible_deals: {
          title: 'Auto-Invest: No Eligible Deals',
          message: 'Your auto-invest plan ran but no deals matched your risk/commodity filters.',
        },
      };

      const msg = messages[event];
      await this.notificationsService.createNotification({
        userId: plan.investorId,
        type: 'system' as any,
        title: msg.title,
        message: msg.message,
        metadataJson: { planId: plan.id, event, ...meta },
      });
    } catch (err: any) {
      this.logger.warn({ planId: plan.id, error: err.message }, 'Auto-invest: failed to send notification');
    }
  }
}
