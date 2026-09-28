import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, DataSource } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import { v4 as uuidv4 } from 'uuid';
import { AutoInvestPlan, AutoInvestCadence } from './entities/auto-invest-plan.entity';
import {
  CreateAutoInvestPlanDto,
  UpdateAutoInvestPlanDto,
} from './dto/auto-invest-plan.dto';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { RiskScoringService } from '../trade-deals/risk-scoring.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QueueService } from '../queue/queue.service';
import { User } from '../auth/entities/user.entity';

/** Maximum consecutive failures before a plan is auto-paused */
const MAX_CONSECUTIVE_FAILURES = 3;

/** How many open deals to evaluate per plan run (prevents runaway scans) */
const MAX_DEALS_TO_EVALUATE = 20;

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
    private readonly queueService: QueueService,
    private readonly dataSource: DataSource,
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
    if (investor.kycStatus !== 'approved') {
      throw new ForbiddenException('KYC must be approved before creating an auto-invest plan.');
    }

    const plan = this.planRepo.create({
      investorId,
      amountUsd: dto.amountUsd,
      cadence: dto.cadence,
      fundingWallet: dto.fundingWallet,
      maxRiskScore: dto.maxRiskScore ?? 75,
      dealTypeFilter: dto.dealTypeFilter ?? null,
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

    if (dto.amountUsd !== undefined) plan.amountUsd = dto.amountUsd;
    if (dto.cadence !== undefined) plan.cadence = dto.cadence;
    if (dto.fundingWallet !== undefined) plan.fundingWallet = dto.fundingWallet;
    if (dto.maxRiskScore !== undefined) plan.maxRiskScore = dto.maxRiskScore;
    if (dto.dealTypeFilter !== undefined) plan.dealTypeFilter = dto.dealTypeFilter ?? null;
    if (dto.dailyCapUsd !== undefined) plan.dailyCapUsd = dto.dailyCapUsd ?? null;

    return this.planRepo.save(plan);
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
   * Runs every 15 minutes. Evaluates all active plans whose next_run_at has
   * elapsed, selects best-fit open deals, and enqueues investment.fund jobs.
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
    const dailyCapUsd = plan.dailyCapUsd ? Number(plan.dailyCapUsd) : null;
    const amountUsd = Number(plan.amountUsd);
    const maxRiskScore = Number(plan.maxRiskScore);

    // ── Daily cap check ────────────────────────────────────────────────────
    if (dailyCapUsd !== null) {
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);

      // We track today's allocation via auto_invest_executions (simplified:
      // use plan's lastRunAt date to detect same-day runs)
      if (
        plan.lastRunAt &&
        plan.lastRunAt >= todayStart &&
        amountUsd >= dailyCapUsd
      ) {
        this.logger.info(
          { planId: plan.id },
          'Auto-invest: daily cap reached, skipping run',
        );
        await this.advancePlanSchedule(plan, now);
        return;
      }
    }

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
      if (
        plan.dealTypeFilter?.length &&
        !plan.dealTypeFilter.includes(deal.commodity.toLowerCase())
      ) {
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
    const effectiveAmount = Math.min(amountUsd, remaining);
    const tokenAmount = Math.floor(effectiveAmount / 100);

    if (tokenAmount < 1) {
      this.logger.warn(
        { planId: plan.id, dealId: selectedDeal.id },
        'Auto-invest: effective amount too small for 1 token',
      );
      await this.advancePlanSchedule(plan, now);
      return;
    }

    // ── Check funding wallet has sufficient balance ────────────────────────
    // (In production this should query Stellar balance; here we optimistically
    //  proceed and let the queue processor handle failures)

    // ── Enqueue investment.fund with idempotency key ───────────────────────
    const idempotencyKey = `auto-invest-${plan.id}-${now.toISOString().slice(0, 10)}`;

    try {
      await this.queueService.enqueueInvestmentFund({
        investmentId: uuidv4(),
        signedXdr: '', // Queue processor handles signing via escrow key
        escrowPublicKey: selectedDeal.escrowPublicKey ?? '',
        encryptedEscrowSecret: selectedDeal.escrowSecretKey ?? '',
        assetCode: selectedDeal.tokenSymbol ?? '',
        tokenAmount,
        investorWallet: plan.fundingWallet,
        amountUsd: tokenAmount * 100,
        correlationId: idempotencyKey,
      });

      this.logger.info(
        {
          planId: plan.id,
          dealId: selectedDeal.id,
          tokenAmount,
          amountUsd: tokenAmount * 100,
          idempotencyKey,
        },
        'Auto-invest: investment.fund enqueued',
      );

      // ── Success path ──────────────────────────────────────────────────────
      plan.consecutiveFailures = 0;
      plan.lastRunAt = now;
      await this.advancePlanSchedule(plan, now);
      await this.notifyInvestor(plan, 'allocated', { dealId: selectedDeal.id, tokenAmount, amountUsd: tokenAmount * 100 });
    } catch (err: any) {
      this.logger.error(
        { planId: plan.id, error: err.message },
        'Auto-invest: failed to enqueue investment',
      );

      plan.consecutiveFailures += 1;

      if (plan.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        plan.status = 'paused';
        this.logger.warn(
          { planId: plan.id },
          `Auto-invest: plan paused after ${MAX_CONSECUTIVE_FAILURES} consecutive failures`,
        );
        await this.notifyInvestor(plan, 'paused_due_to_failures');
      }

      plan.nextRunAt = addCadenceDays(now, plan.cadence);
      await this.planRepo.save(plan);
      throw err;
    }
  }

  private async advancePlanSchedule(plan: AutoInvestPlan, now: Date): Promise<void> {
    plan.nextRunAt = addCadenceDays(now, plan.cadence);
    await this.planRepo.save(plan);
  }

  private async notifyInvestor(
    plan: AutoInvestPlan,
    event: 'allocated' | 'skipped_no_deals' | 'skipped_no_eligible_deals' | 'paused_due_to_failures',
    meta?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const messages: Record<string, { title: string; message: string }> = {
        allocated: {
          title: 'Auto-Invest: Allocation Made',
          message: `Your auto-invest plan allocated ${meta?.tokenAmount} token(s) ($${meta?.amountUsd}) to deal ${meta?.dealId}.`,
        },
        skipped_no_deals: {
          title: 'Auto-Invest: No Open Deals',
          message: 'Your auto-invest plan ran but found no open deals to invest in.',
        },
        skipped_no_eligible_deals: {
          title: 'Auto-Invest: No Eligible Deals',
          message: 'Your auto-invest plan ran but no deals matched your risk/commodity filters.',
        },
        paused_due_to_failures: {
          title: 'Auto-Invest Plan Paused',
          message: `Your auto-invest plan has been paused after ${MAX_CONSECUTIVE_FAILURES} consecutive allocation failures. Please review and resume manually.`,
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
