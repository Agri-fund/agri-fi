import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AmlCase, AmlCaseTimelineEntry } from './entities/aml-case.entity';
import { AmlAlert } from './entities/aml-alert.entity';
import { AmlMonitoringRule } from './entities/aml-monitoring-rule.entity';
import { AmlDispositionFeedback } from './entities/aml-disposition-feedback.entity';
import {
  CreateAmlCaseDto,
  CloseAmlCaseDto,
  UpdateAmlCaseDto,
} from './dto/aml-monitoring.dto';
import {
  AmlAlertStatus,
  AmlDisposition,
  AmlSeverity,
  sensitivityFromDisposition,
} from './aml.constants';
import { AuditService } from '../audit/audit.service';

/** Analyst SLA in days, by case priority. */
const SLA_DAYS: Record<AmlSeverity, number> = {
  CRITICAL: 3,
  HIGH: 5,
  MEDIUM: 10,
  LOW: 30,
};

const SEVERITY_RANK: Record<AmlSeverity, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

export interface AmlCaseSummary {
  open: number;
  inReview: number;
  escalated: number;
  closed: number;
  overdue: number;
  falsePositiveRate: number;
}

/**
 * Investigation workflow for flagged transactions (#1217): grouping alerts into
 * a case, assigning it, and closing it with a disposition. The disposition is
 * what feeds false-positive learning, so it is recorded immutably in
 * `aml_disposition_feedback` and mirrored onto the rule counters.
 */
@Injectable()
export class AmlCaseService {
  private readonly logger = new Logger(AmlCaseService.name);

  constructor(
    @InjectRepository(AmlCase)
    private readonly caseRepository: Repository<AmlCase>,
    @InjectRepository(AmlAlert)
    private readonly alertRepository: Repository<AmlAlert>,
    @InjectRepository(AmlMonitoringRule)
    private readonly ruleRepository: Repository<AmlMonitoringRule>,
    @InjectRepository(AmlDispositionFeedback)
    private readonly feedbackRepository: Repository<AmlDispositionFeedback>,
    private readonly auditService: AuditService,
  ) {}

  private async nextCaseNumber(): Promise<string> {
    const year = new Date().getUTCFullYear();
    const prefix = `AML-CASE-${year}-`;
    const count = await this.caseRepository
      .createQueryBuilder('case')
      .where('case.caseNumber LIKE :prefix', { prefix: `${prefix}%` })
      .getCount();
    const seq = String(count + 1).padStart(6, '0');
    return `${prefix}${seq}`;
  }

  private timeline(
    caseEntity: AmlCase,
    action: string,
    actorId: string | null,
    detail: Record<string, unknown> = {},
  ): AmlCaseTimelineEntry[] {
    return [
      ...(caseEntity.timeline ?? []),
      {
        at: new Date().toISOString(),
        action,
        actorId: actorId ?? null,
        detail,
      },
    ];
  }

  private dueDate(priority: AmlSeverity, from = new Date()): Date {
    const days = SLA_DAYS[priority] ?? SLA_DAYS.MEDIUM;
    return new Date(from.getTime() + days * 86_400_000);
  }

  async createCase(dto: CreateAmlCaseDto, actorId?: string): Promise<AmlCase> {
    const alerts = dto.alertIds?.length
      ? await this.alertRepository.find({ where: { id: In(dto.alertIds) } })
      : [];
    if (dto.alertIds?.length && alerts.length !== dto.alertIds.length) {
      throw new NotFoundException('One or more alerts do not exist');
    }
    if (alerts.some((alert) => alert.caseId)) {
      throw new BadRequestException(
        'One or more alerts already belong to a case',
      );
    }
    const subjectUserId =
      dto.subjectUserId ?? alerts.find((alert) => alert.userId)?.userId ?? null;
    const priority: AmlSeverity =
      dto.priority ??
      alerts
        .map((alert) => alert.severity)
        .sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a])[0] ??
      'MEDIUM';

    const caseEntity = this.caseRepository.create({
      caseNumber: await this.nextCaseNumber(),
      title:
        dto.title ??
        (alerts.length > 0
          ? `AML review: ${[...new Set(alerts.map((alert) => alert.patternType))].join(', ')}`
          : 'AML investigation'),
      summary:
        dto.summary ?? alerts.map((alert) => `- ${alert.title}`).join('\n'),
      subjectUserId,
      priority,
      status: 'open',
      alertIds: alerts.map((alert) => alert.id),
      riskScore: alerts.reduce(
        (max, alert) => Math.max(max, Number(alert.riskScore)),
        0,
      ),
      exposureUsd: alerts.reduce(
        (total, alert) => total + Number(alert.amountUsd ?? 0),
        0,
      ),
      subjectSnapshot: {
        patterns: [...new Set(alerts.map((alert) => alert.patternType))],
        ruleCodes: [...new Set(alerts.map((alert) => alert.ruleCode))],
        flowIds: [
          ...new Set(
            alerts.flatMap(
              (alert) => (alert.evidence?.flowIds as string[]) ?? [],
            ),
          ),
        ],
      },
      openedBy: actorId ?? null,
      timeline: [
        {
          at: new Date().toISOString(),
          action: 'case_opened',
          actorId: actorId ?? null,
          detail: { alertIds: alerts.map((alert) => alert.id) },
        },
      ],
      dueAt: this.dueDate(priority),
    });

    const saved = await this.caseRepository.save(caseEntity);
    if (alerts.length) {
      await this.alertRepository.update(
        { id: In(alerts.map((alert) => alert.id)) },
        { caseId: saved.id, status: 'triaged' as AmlAlertStatus },
      );
    }
    await this.auditService.logEvent({
      actorId: actorId ?? null,
      route: 'POST /admin/aml/cases',
      statusCode: 201,
      requestDetails: {
        caseNumber: saved.caseNumber,
        alertIds: saved.alertIds,
      },
    });
    return this.caseRepository.findOne({ where: { id: saved.id } });
  }

  async attachAlerts(
    caseId: string,
    alertIds: string[],
    actorId?: string,
  ): Promise<AmlCase> {
    const target = await this.getCase(caseId);
    const alerts = await this.alertRepository.find({
      where: { id: In(alertIds) },
    });
    if (alerts.length !== alertIds.length) {
      throw new NotFoundException('One or more alerts do not exist');
    }
    if (alerts.some((alert) => alert.caseId && alert.caseId !== caseId)) {
      throw new BadRequestException(
        'One or more alerts belong to another case',
      );
    }
    await this.alertRepository.update(
      { id: In(alertIds) },
      { caseId: target.id, status: 'triaged' as AmlAlertStatus },
    );
    target.alertIds = [...new Set([...target.alertIds, ...alertIds])];
    target.riskScore = Math.max(
      Number(target.riskScore),
      ...alerts.map((alert) => Number(alert.riskScore)),
    );
    target.exposureUsd =
      Number(target.exposureUsd) +
      alerts.reduce((total, alert) => total + Number(alert.amountUsd ?? 0), 0);
    target.timeline = this.timeline(
      target,
      'alerts_attached',
      actorId ?? null,
      { alertIds },
    );
    return this.caseRepository.save(target);
  }

  async updateCase(
    caseId: string,
    dto: UpdateAmlCaseDto,
    actorId?: string,
  ): Promise<AmlCase> {
    const target = await this.getCase(caseId);
    if (target.status === 'closed') {
      throw new BadRequestException(
        'Closed cases cannot be edited; reopen a new case instead',
      );
    }
    if (dto.status) {
      target.timeline = this.timeline(
        target,
        `status_${dto.status}`,
        actorId ?? null,
        {},
      );
      target.status = dto.status;
    }
    if (dto.priority) {
      target.priority = dto.priority;
      target.dueAt = this.dueDate(dto.priority);
      target.timeline = this.timeline(
        target,
        'priority_changed',
        actorId ?? null,
        {
          priority: dto.priority,
        },
      );
    }
    if (dto.assignedTo) {
      target.assignedTo = dto.assignedTo;
      target.timeline = this.timeline(target, 'assigned', actorId ?? null, {
        assignedTo: dto.assignedTo,
      });
    }
    if (dto.notes) {
      target.notes = dto.notes;
      target.timeline = this.timeline(target, 'note_added', actorId ?? null, {
        length: dto.notes.length,
      });
    }
    return this.caseRepository.save(target);
  }

  async closeCase(
    caseId: string,
    dto: CloseAmlCaseDto,
    actorId?: string,
  ): Promise<AmlCase> {
    const target = await this.getCase(caseId);
    if (target.status === 'closed') {
      throw new BadRequestException('Case is already closed');
    }
    target.status = 'closed';
    target.disposition = dto.disposition;
    target.closedAt = new Date();
    target.notes = dto.notes ?? target.notes;
    target.timeline = this.timeline(target, 'case_closed', actorId ?? null, {
      disposition: dto.disposition,
    });
    const saved = await this.caseRepository.save(target);
    await this.recordDispositionForCase(
      saved,
      dto.disposition,
      dto.notes ?? null,
      actorId,
    );
    await this.auditService.logEvent({
      actorId: actorId ?? null,
      route: 'POST /admin/aml/cases/close',
      statusCode: 200,
      requestDetails: {
        caseNumber: saved.caseNumber,
        disposition: dto.disposition,
      },
    });
    return saved;
  }

  /** Triage a single alert; false positives feed the rule's sensitivity tuning. */
  async triageAlert(
    alertId: string,
    disposition: AmlDisposition,
    reason: string | null,
    actorId?: string,
  ): Promise<AmlAlert> {
    const alert = await this.alertRepository.findOne({
      where: { id: alertId },
    });
    if (!alert) throw new NotFoundException(`Alert ${alertId} not found`);
    if (alert.reviewedAt) {
      throw new BadRequestException('Alert has already been triaged');
    }
    const statusMap: Record<AmlDisposition, AmlAlertStatus> = {
      false_positive: 'false_positive',
      sar_filed: 'escalated',
      no_action: 'dismissed',
      referred_to_authority: 'escalated',
      account_restricted: 'escalated',
    };
    alert.status = statusMap[disposition];
    alert.reviewedBy = actorId ?? null;
    alert.reviewedAt = new Date();
    const saved = await this.alertRepository.save(alert);
    await this.recordFeedback(saved, disposition, reason, actorId);
    return saved;
  }

  private async recordDispositionForCase(
    target: AmlCase,
    disposition: AmlDisposition,
    reason: string | null,
    actorId?: string,
  ): Promise<void> {
    const alerts = target.alertIds.length
      ? await this.alertRepository.find({ where: { id: In(target.alertIds) } })
      : [];
    const untriaged = alerts.filter((alert) => !alert.reviewedAt);
    for (const alert of untriaged) {
      await this.triageAlert(alert.id, disposition, reason, actorId);
    }
    if (untriaged.length === 0) {
      await this.recordFeedback(
        {
          id: null,
          ruleId: null,
          ruleCode: 'CASE',
          patternType: '',
          caseId: target.id,
        } as unknown as AmlAlert,
        disposition,
        reason,
        actorId,
        target.id,
      );
    }
  }

  /**
   * Persist one analyst judgement and re-tune the rule that produced the alert.
   * `false_positive` raises the rule's counter, everything else counts as a
   * confirmed (true) positive for tuning purposes.
   */
  private async recordFeedback(
    alert: Pick<AmlAlert, 'id' | 'ruleId' | 'ruleCode' | 'patternType'>,
    disposition: AmlDisposition,
    reason: string | null,
    actorId: string | undefined,
    caseId?: string | null,
  ): Promise<void> {
    const isFalsePositive = disposition === 'false_positive';
    let sensitivityBefore: number | null = null;
    let sensitivityAfter: number | null = null;

    if (alert.ruleId) {
      const rule = await this.ruleRepository.findOne({
        where: { id: alert.ruleId },
      });
      if (rule) {
        sensitivityBefore = Number(rule.sensitivityMultiplier);
        if (isFalsePositive) {
          rule.falsePositiveCount = Number(rule.falsePositiveCount) + 1;
        } else {
          rule.truePositiveCount = Number(rule.truePositiveCount) + 1;
        }
        rule.sensitivityMultiplier = sensitivityFromDisposition(
          Number(rule.falsePositiveCount),
          Number(rule.truePositiveCount),
        );
        sensitivityAfter = Number(rule.sensitivityMultiplier);
        await this.ruleRepository.save(rule);
        if (sensitivityBefore !== sensitivityAfter) {
          this.logger.log(
            `Rule ${rule.ruleCode} sensitivity ${sensitivityBefore} -> ${sensitivityAfter}`,
          );
        }
      }
    }

    await this.feedbackRepository.save(
      this.feedbackRepository.create({
        alertId: alert.id ?? null,
        caseId: caseId ?? null,
        ruleCode: alert.ruleCode,
        ruleId: alert.ruleId ?? null,
        patternType: alert.patternType ?? '',
        disposition,
        recordedBy: actorId ?? null,
        reason,
        sensitivityBefore,
        sensitivityAfter,
      }),
    );
  }

  async getCase(id: string): Promise<AmlCase> {
    const found = await this.caseRepository.findOne({ where: { id } });
    if (!found) throw new NotFoundException(`Case ${id} not found`);
    return found;
  }

  async listCases(options: {
    status?: string;
    assignedTo?: string;
    subjectUserId?: string;
    limit?: number;
    page?: number;
  }): Promise<{ items: AmlCase[]; total: number }> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const page = Math.max(options.page ?? 0, 0);
    const where: Record<string, unknown> = {};
    if (options.status) where.status = options.status;
    if (options.assignedTo) where.assignedTo = options.assignedTo;
    if (options.subjectUserId) where.subjectUserId = options.subjectUserId;
    const [items, total] = await this.caseRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
      skip: page * limit,
    });
    return { items, total };
  }

  /**
   * Triage queue. Highest risk first so the most exposed money is always on the
   * analyst's first page; `status` is normally left at the default open set.
   */
  async listAlerts(options: {
    status?: string;
    userId?: string;
    patternType?: string;
    ruleCode?: string;
    limit?: number;
    page?: number;
  }): Promise<{ items: AmlAlert[]; total: number }> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const page = Math.max(options.page ?? 0, 0);
    const where: Record<string, unknown> = {};
    if (options.status) where.status = options.status;
    if (options.userId) where.userId = options.userId;
    if (options.patternType) where.patternType = options.patternType;
    if (options.ruleCode) where.ruleCode = options.ruleCode;
    const [items, total] = await this.alertRepository.findAndCount({
      where,
      order: { riskScore: 'DESC', createdAt: 'DESC' },
      take: limit,
      skip: page * limit,
    });
    return { items, total };
  }

  async overdueCases(now = new Date()): Promise<AmlCase[]> {
    return this.caseRepository
      .createQueryBuilder('case')
      .where('case.status <> :closed', { closed: 'closed' })
      .andWhere('case.due_at IS NOT NULL')
      .andWhere('case.due_at < :now', { now })
      .orderBy('case.due_at', 'ASC')
      .getMany();
  }

  /** Roll-up used by the compliance report and the monitoring dashboard. */
  async summary(): Promise<AmlCaseSummary> {
    const rows = await this.caseRepository
      .createQueryBuilder('case')
      .select('case.status', 'status')
      .addSelect('COUNT(1)', 'count')
      .groupBy('case.status')
      .getRawMany<{ status: string; count: string }>();
    const byStatus = rows.reduce(
      (acc, row) => ({ ...acc, [row.status]: Number(row.count) }),
      {} as Record<string, number>,
    );
    const feedback = await this.feedbackRepository.count();
    const falsePositives = await this.feedbackRepository.count({
      where: { disposition: 'false_positive' },
    });
    const overdue = (await this.overdueCases()).length;
    return {
      open: byStatus.open ?? 0,
      inReview: byStatus.in_review ?? 0,
      escalated: byStatus.escalated ?? 0,
      closed: byStatus.closed ?? 0,
      overdue,
      falsePositiveRate: feedback > 0 ? falsePositives / feedback : 0,
    };
  }
}
