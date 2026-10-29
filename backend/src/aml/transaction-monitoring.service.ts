import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Investment } from '../investments/entities/investment.entity';
import { PaymentDistribution } from '../escrow/entities/payment-distribution.entity';
import { TransactionLog } from '../database/entities/transaction-log.entity';
import { User } from '../auth/entities/user.entity';
import { AmlAlert } from './entities/aml-alert.entity';
import { AmlMonitoringRun } from './entities/aml-monitoring-run.entity';
import { AmlMonitoringRule } from './entities/aml-monitoring-rule.entity';
import { CashFlow, PatternMatch } from './aml.constants';
import { runDetector } from './aml-detectors';
import { AmlRulesService } from './aml-rules.service';
import { AmlCaseService } from './aml-case.service';
import { RegulatoryRuleEngineService } from '../compliance/regulatory-rule-engine.service';
import { AuditService } from '../audit/audit.service';

export interface SweepOptions {
  windowStart?: Date;
  windowEnd?: Date;
  userId?: string;
  trigger?: 'cron' | 'manual' | 'scheduled';
  dryRun?: boolean;
}

export interface SweepResult {
  runId: string | null;
  windowStart: Date;
  windowEnd: Date;
  usersEvaluated: number;
  flowsEvaluated: number;
  rulesApplied: number;
  alertsRaised: number;
  alertsSkippedDuplicate: number;
  alertsBelowThreshold: number;
  casesOpened: string[];
  status: string;
}

interface Candidate {
  match: PatternMatch;
  userId: string;
  userFlows: CashFlow[];
}

/**
 * Automated AML transaction monitoring (#1217).
 *
 * Money movements are projected out of the tables that already hold them
 * (`investments` for inflows, `payment_distributions` for payouts,
 * `transaction_logs` for on-chain activity) into one cash-flow shape, the
 * configured windowed detectors run per account, and each finding is screened a
 * second time through the existing regulatory rule engine. Findings are deduped
 * by key so re-running a window is safe, and every sweep is recorded in
 * `aml_monitoring_runs` so compliance can prove coverage of a date range.
 */
@Injectable()
export class TransactionMonitoringService {
  private readonly logger = new Logger(TransactionMonitoringService.name);

  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepository: Repository<Investment>,
    @InjectRepository(PaymentDistribution)
    private readonly distributionRepository: Repository<PaymentDistribution>,
    @InjectRepository(TransactionLog)
    private readonly transactionLogRepository: Repository<TransactionLog>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(AmlAlert)
    private readonly alertRepository: Repository<AmlAlert>,
    @InjectRepository(AmlMonitoringRun)
    private readonly runRepository: Repository<AmlMonitoringRun>,
    private readonly rulesService: AmlRulesService,
    private readonly caseService: AmlCaseService,
    private readonly ruleEngine: RegulatoryRuleEngineService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
  ) {}

  get isEnabled(): boolean {
    return (
      String(
        this.config.get('AML_MONITORING_ENABLED', 'true'),
      ).toLowerCase() !== 'false'
    );
  }

  private get autoCaseScore(): number {
    return Number(this.config.get('AML_AUTO_CASE_THRESHOLD_SCORE', '70'));
  }

  /**
   * Union of money movements over a period. `investments` rows are investor
   * inflows, `payment_distributions` rows are confirmed payouts, and successful
   * `transaction_logs` rows are on-chain activity with no USD amount — they carry
   * velocity and layering signal even though they cannot move a sum.
   */
  async loadCashFlows(
    from: Date,
    to: Date,
    userId?: string,
  ): Promise<CashFlow[]> {
    const inflowQb = this.investmentRepository
      .createQueryBuilder('investment')
      .leftJoin('trade_deals', 'deal', 'deal.id = investment.trade_deal_id')
      .select('investment.id', 'id')
      .addSelect('investment.investor_id', 'userId')
      .addSelect('investment.amount_usd', 'amountUsd')
      .addSelect('investment.created_at', 'at')
      .addSelect('investment.trade_deal_id', 'dealId')
      .addSelect('deal.country', 'counterpartyCountry')
      .addSelect('deal.commodity', 'commodity')
      .where('investment.created_at >= :from', { from })
      .andWhere('investment.created_at <= :to', { to })
      .andWhere('investment.deleted_at IS NULL');
    if (userId)
      inflowQb.andWhere('investment.investor_id = :userId', { userId });

    const outflowQb = this.distributionRepository
      .createQueryBuilder('distribution')
      .leftJoin('trade_deals', 'deal', 'deal.id = distribution.trade_deal_id')
      .select('distribution.id', 'id')
      .addSelect('distribution.recipient_id', 'userId')
      .addSelect('distribution.amount_usd', 'amountUsd')
      .addSelect('distribution.created_at', 'at')
      .addSelect('distribution.trade_deal_id', 'dealId')
      .addSelect('deal.country', 'counterpartyCountry')
      .addSelect('deal.commodity', 'commodity')
      .where('distribution.created_at >= :from', { from })
      .andWhere('distribution.created_at <= :to', { to })
      .andWhere("distribution.recipient_type = 'investor'")
      .andWhere("distribution.status = 'confirmed'");
    if (userId)
      outflowQb.andWhere('distribution.recipient_id = :userId', { userId });

    const logQb = this.transactionLogRepository
      .createQueryBuilder('log')
      .select('log.id', 'id')
      .addSelect('log.user_id', 'userId')
      .addSelect('log.created_at', 'at')
      .addSelect('log.deal_id', 'dealId')
      .where('log.created_at >= :from', { from })
      .andWhere('log.created_at <= :to', { to })
      .andWhere("log.status = 'success'");
    if (userId) logQb.andWhere('log.user_id = :userId', { userId });

    const [inflows, outflows, logs] = await Promise.all([
      inflowQb.getRawMany<Record<string, unknown>>(),
      outflowQb.getRawMany<Record<string, unknown>>(),
      logQb.getRawMany<Record<string, unknown>>(),
    ]);

    const toFlow = (
      row: Record<string, unknown>,
      direction: CashFlow['direction'],
      source: CashFlow['source'],
    ): CashFlow => ({
      id: String(row.id),
      userId: row.userId ? String(row.userId) : '',
      direction,
      amountUsd: Number(row.amountUsd ?? 0),
      at: row.at instanceof Date ? row.at : new Date(String(row.at)),
      dealId: row.dealId ? String(row.dealId) : null,
      source,
      counterpartyCountry: row.counterpartyCountry
        ? String(row.counterpartyCountry)
        : null,
      commodity: row.commodity ? String(row.commodity) : null,
    });

    return [
      ...inflows.map((row) => toFlow(row, 'in', 'investments')),
      ...outflows.map((row) => toFlow(row, 'out', 'payment_distributions')),
      ...logs.map((row) => toFlow(row, 'out', 'transaction_logs')),
    ].filter((flow) => flow.userId !== '');
  }

  private groupByUser(flows: CashFlow[]): Map<string, CashFlow[]> {
    const grouped = new Map<string, CashFlow[]>();
    for (const flow of flows) {
      const bucket = grouped.get(flow.userId) ?? [];
      bucket.push(flow);
      grouped.set(flow.userId, bucket);
    }
    for (const bucket of grouped.values()) {
      bucket.sort((a, b) => a.at.getTime() - b.at.getTime());
    }
    return grouped;
  }

  /**
   * Second-stage screening: run the finding through the regulatory rule engine so
   * jurisdiction policy (limits, embargoes, accreditation) is applied to the same
   * money movement the behavioural detector flagged.
   */
  private async engineDecision(
    match: PatternMatch,
    flows: CashFlow[],
  ): Promise<Record<string, unknown>> {
    const representative =
      flows.find((flow) => flow.id === match.flowIds?.[0]) ?? flows[0];
    if (!representative) return {};
    try {
      const result = await this.ruleEngine.screenTransaction({
        id: representative.id,
        amountUsd: match.amountUsd ?? representative.amountUsd,
        fromCountry: representative.counterpartyCountry ?? 'GLOBAL',
        toCountry: representative.counterpartyCountry ?? 'GLOBAL',
        commodity: representative.commodity ?? '',
      });
      return {
        regulatoryDecision: result.decision,
        regulatoryMatchedRules: (result.matchedRules ?? []).map(
          (rule) => rule.ruleCode,
        ),
        regulatoryExecutionId: result.executionId,
      };
    } catch (error) {
      // A policy-engine outage must not stop monitoring from recording the finding.
      this.logger.warn(
        `Regulatory screening failed for ${match.dedupeKey}: ${(error as Error).message}`,
      );
      return { regulatoryDecision: 'engine_unavailable' };
    }
  }

  private async findExistingKeys(keys: string[]): Promise<Set<string>> {
    if (keys.length === 0) return new Set();
    const rows = await this.alertRepository
      .createQueryBuilder('alert')
      .select('alert.dedupeKey', 'dedupeKey')
      .where('alert.dedupeKey IN (:...keys)', { keys })
      .getRawMany<{ dedupeKey: string }>();
    return new Set(rows.map((row) => row.dedupeKey));
  }

  /** Rule codes that already have an open (not closed) case per account. */
  private async openCaseRuleCodes(
    userIds: string[],
  ): Promise<Map<string, Set<string>>> {
    const result = new Map<string, Set<string>>();
    if (userIds.length === 0) return result;
    const rows = await this.alertRepository
      .createQueryBuilder('alert')
      .innerJoin('aml_cases', 'case', 'case.id = alert.case_id')
      .select('alert.user_id', 'userId')
      .addSelect('alert.rule_code', 'ruleCode')
      .where('alert.user_id IN (:...userIds)', { userIds })
      .andWhere("case.status <> 'closed'")
      .getRawMany<{ userId: string; ruleCode: string }>();
    for (const row of rows) {
      const bucket = result.get(row.userId) ?? new Set<string>();
      bucket.add(row.ruleCode);
      result.set(row.userId, bucket);
    }
    return result;
  }

  /** Evaluate every enabled flow rule against a set of cash flows. */
  async evaluate(
    flowsByUser: Map<string, CashFlow[]>,
    rules: AmlMonitoringRule[],
    users: Map<string, string | null>,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<Candidate[]> {
    const candidates: Candidate[] = [];
    for (const [userId, userFlows] of flowsByUser) {
      const inWindow = userFlows.filter(
        (flow) => flow.at >= windowStart && flow.at <= windowEnd,
      );
      if (inWindow.length === 0) continue;
      for (const rule of rules) {
        const detected = runDetector(rule, userFlows, {
          userCountry: users.get(userId) ?? null,
        });
        for (const found of detected) {
          // Only report findings whose triggering movement is inside the window.
          if (
            !found.flowIds?.some((id) =>
              inWindow.some((flow) => flow.id === id),
            )
          ) {
            continue;
          }
          candidates.push({ match: found, userId, userFlows });
        }
      }
    }
    return candidates;
  }

  /** One monitoring sweep over a time window. */
  async runSweep(options: SweepOptions = {}): Promise<SweepResult> {
    const windowEnd = options.windowEnd ?? new Date();
    const windowStart =
      options.windowStart ?? new Date(windowEnd.getTime() - 24 * 3_600_000);
    const startedAt = Date.now();

    if (!this.isEnabled) {
      this.logger.log(
        'AML monitoring is disabled (AML_MONITORING_ENABLED=false); sweep skipped',
      );
      return {
        runId: null,
        windowStart,
        windowEnd,
        usersEvaluated: 0,
        flowsEvaluated: 0,
        rulesApplied: 0,
        alertsRaised: 0,
        alertsSkippedDuplicate: 0,
        alertsBelowThreshold: 0,
        casesOpened: [],
        status: 'skipped',
      };
    }

    const rules = await this.rulesService.activeFlowRules();
    const maxWindowHours = rules.reduce(
      (max, rule) => Math.max(max, Number(rule.windowHours) || 0),
      24,
    );
    // Load history before the window so sliding detectors see full context.
    const loadFrom = new Date(
      windowStart.getTime() - maxWindowHours * 3_600_000,
    );
    const flows = await this.loadCashFlows(loadFrom, windowEnd, options.userId);
    const flowsByUser = this.groupByUser(flows);

    const userIds = [...flowsByUser.keys()];
    const users = new Map<string, string | null>();
    if (userIds.length > 0) {
      const rows = await this.userRepository
        .createQueryBuilder('user')
        .select('user.id', 'id')
        .addSelect('user.country', 'country')
        .where('user.id IN (:...userIds)', { userIds })
        .getRawMany<{ id: string; country: string | null }>();
      for (const row of rows) users.set(row.id, row.country ?? null);
    }

    const run = options.dryRun
      ? null
      : await this.runRepository.save(
          this.runRepository.create({
            triggerType: options.trigger ?? 'manual',
            windowStart,
            windowEnd,
            status: 'running',
            rulesApplied: rules.length,
          }),
        );

    const candidates = await this.evaluate(
      flowsByUser,
      rules,
      users,
      windowStart,
      windowEnd,
    );
    const seen = await this.findExistingKeys(
      candidates.map((c) => c.match.dedupeKey),
    );
    const openCases = await this.openCaseRuleCodes(userIds);

    let alertsRaised = 0;
    let alertsSkippedDuplicate = 0;
    let alertsBelowThreshold = 0;
    const casesOpened: string[] = [];

    for (const candidate of candidates) {
      const { match, userId, userFlows } = candidate;
      if (seen.has(match.dedupeKey)) {
        alertsSkippedDuplicate += 1;
        continue;
      }
      const rule = rules.find((candidate2) => candidate2.id === match.ruleId);
      if (rule && match.riskScore < Number(rule.alertThresholdScore)) {
        alertsBelowThreshold += 1;
        continue;
      }
      seen.add(match.dedupeKey);

      if (options.dryRun) {
        alertsRaised += 1;
        continue;
      }

      const regulatory = await this.engineDecision(match, userFlows);
      const alert = await this.alertRepository.save(
        this.alertRepository.create({
          patternType: match.patternType,
          ruleId: match.ruleId,
          ruleCode: match.ruleCode,
          userId,
          dealId:
            userFlows.find((flow) => flow.id === match.flowIds?.[0])?.dealId ??
            null,
          severity: match.severity,
          action: match.action,
          riskScore: match.riskScore,
          amountUsd: match.amountUsd ?? null,
          title: match.title,
          matchReason: match.reason,
          evidence: {
            ...match.evidence,
            flowIds: match.flowIds ?? [],
            regulatory,
          },
          status: 'pending',
          dedupeKey: match.dedupeKey,
          runId: run?.id ?? null,
        }),
      );
      alertsRaised += 1;

      const alreadyOpen = openCases.get(userId);
      if (
        match.riskScore >= this.autoCaseScore &&
        !(alreadyOpen?.has(match.ruleCode) ?? false)
      ) {
        const created = await this.caseService.createCase({
          alertIds: [alert.id],
          subjectUserId: userId,
        });
        casesOpened.push(created.caseNumber);
        if (!alreadyOpen) openCases.set(userId, new Set());
        openCases.get(userId)?.add(match.ruleCode);
      }
    }

    const result: SweepResult = {
      runId: run?.id ?? null,
      windowStart,
      windowEnd,
      usersEvaluated: new Set(candidates.map((candidate) => candidate.userId))
        .size,
      flowsEvaluated: flows.length,
      rulesApplied: rules.length,
      alertsRaised,
      alertsSkippedDuplicate,
      alertsBelowThreshold,
      casesOpened,
      status: 'completed',
    };

    if (run) {
      await this.runRepository.update(
        { id: run.id },
        {
          status: 'completed',
          usersEvaluated: result.usersEvaluated,
          flowsEvaluated: result.flowsEvaluated,
          alertsRaised: result.alertsRaised,
          casesOpened: casesOpened.length,
          durationMs: Date.now() - startedAt,
          finishedAt: new Date(),
        },
      );
      await this.auditService.logEvent({
        actorId: null,
        route: 'AML_MONITORING_SWEEP',
        statusCode: 200,
        requestDetails: {
          runId: run.id,
          windowStart: windowStart.toISOString(),
          windowEnd: windowEnd.toISOString(),
          usersEvaluated: result.usersEvaluated,
          flowsEvaluated: result.flowsEvaluated,
          alertsRaised: result.alertsRaised,
          casesOpened,
        },
      });
    }

    this.logger.log(
      `AML sweep ${windowStart.toISOString()}..${windowEnd.toISOString()}: ` +
        `${result.flowsEvaluated} flows, ${result.usersEvaluated} users, ` +
        `${result.alertsRaised} alerts, ${casesOpened.length} cases opened`,
    );
    return result;
  }

  /**
   * On-demand monitoring for one account. Returns the sweep counters; matches
   * persist as alerts unless `dryRun` is set.
   */
  async monitorUser(
    userId: string,
    lookbackHours = 24 * 30,
    dryRun = false,
  ): Promise<SweepResult> {
    const windowEnd = new Date();
    const windowStart = new Date(
      windowEnd.getTime() - lookbackHours * 3_600_000,
    );
    return this.runSweep({
      windowStart,
      windowEnd,
      userId,
      dryRun,
      trigger: 'manual',
    });
  }

  /** Recent alerts for an account, newest first. */
  async alertsForUser(userId: string, limit = 20): Promise<AmlAlert[]> {
    return this.alertRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /** Rules currently eligible for the sweep, exposed for the dry-run endpoint. */
  async rulesForPreview(): Promise<AmlMonitoringRule[]> {
    return this.rulesService.activeFlowRules();
  }
}
