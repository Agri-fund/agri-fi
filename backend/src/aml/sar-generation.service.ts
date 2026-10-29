import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { AmlCase } from './entities/aml-case.entity';
import { AmlAlert } from './entities/aml-alert.entity';
import { AmlSarReport } from './entities/aml-sar-report.entity';
import { User } from '../auth/entities/user.entity';
import { GenerateSarDto } from './dto/aml-monitoring.dto';
import { SarStatus } from './aml.constants';
import { AuditService } from '../audit/audit.service';

export interface SarAnalytics {
  total: number;
  draft: number;
  reviewed: number;
  submitted: number;
  acknowledged: number;
  amountUsd: number;
}

/**
 * Suspicious Activity Report generation (#1217).
 *
 * A SAR has to be reproducible from evidence, so the narrative is assembled
 * mechanically from the case's alerts (who, what amounts, which patterns, over
 * what period) and the payload is hashed. The report is a draft until a human
 * reviews it - filing is never automatic.
 */
@Injectable()
export class SarGenerationService {
  private readonly logger = new Logger(SarGenerationService.name);

  constructor(
    @InjectRepository(AmlSarReport)
    private readonly sarRepository: Repository<AmlSarReport>,
    @InjectRepository(AmlCase)
    private readonly caseRepository: Repository<AmlCase>,
    @InjectRepository(AmlAlert)
    private readonly alertRepository: Repository<AmlAlert>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly auditService: AuditService,
  ) {}

  private async nextSarNumber(): Promise<string> {
    const year = new Date().getUTCFullYear();
    const prefix = `SAR-${year}-`;
    const count = await this.sarRepository
      .createQueryBuilder('sar')
      .where('sar.sarNumber LIKE :prefix', { prefix: `${prefix}%` })
      .getCount();
    return `${prefix}${String(count + 1).padStart(6, '0')}`;
  }

  /** Canonical payload the hash and the filing both come from. */
  private canonicalPayload(report: {
    sarNumber: string;
    jurisdiction: string;
    authority: string;
    filingType: string;
    subjects: unknown[];
    activities: unknown[];
    suspiciousAmountUsd: number;
    activityFrom: Date | null;
    activityTo: Date | null;
    narrative: string;
  }): string {
    return JSON.stringify(
      {
        ...report,
        activityFrom: report.activityFrom?.toISOString?.() ?? null,
        activityTo: report.activityTo?.toISOString?.() ?? null,
      },
      Object.keys(report).sort(),
    );
  }

  private buildNarrative(args: {
    caseEntity: AmlCase;
    subject: User | null;
    alerts: AmlAlert[];
    totalUsd: number;
    from: Date | null;
    to: Date | null;
  }): string {
    const { caseEntity, subject, alerts, totalUsd, from, to } = args;
    const patterns = [...new Set(alerts.map((alert) => alert.patternType))];
    const ruleCodes = [...new Set(alerts.map((alert) => alert.ruleCode))];
    const subjectLabel = subject
      ? `${subject.fullName ?? 'Account holder'} (user ${subject.id}, country ${subject.country}, KYC ${subject.kycStatus})`
      : `account ${caseEntity.subjectUserId ?? 'unknown'}`;

    const activityLines = alerts.map(
      (alert, index) =>
        `${index + 1}. ${alert.createdAt.toISOString()} - ${alert.title}; ${alert.matchReason} Amount: USD ${Number(alert.amountUsd ?? 0).toFixed(2)}.`,
    );

    return [
      `Agri-Fi is filing this report on ${caseEntity.caseNumber} concerning ${subjectLabel}.`,
      from && to
        ? `Suspicious activity was observed between ${from.toISOString()} and ${to.toISOString()} and totals USD ${totalUsd.toFixed(2)} across ${alerts.length} monitored movement(s).`
        : `Suspicious activity totals USD ${totalUsd.toFixed(2)} across ${alerts.length} monitored movement(s).`,
      `Automated monitoring raised the following patterns: ${patterns.join(', ')} (rules: ${ruleCodes.join(', ')}).`,
      ...activityLines,
      `Case priority was ${caseEntity.priority} with effective risk score ${Number(caseEntity.riskScore)}. ` +
        'No customer notification was issued and no explanation was requested from the customer, consistent with tipping-off restrictions.',
      'Supporting transaction records, screening results and the investigation timeline are retained and available on request.',
    ].join('\n');
  }

  async generate(dto: GenerateSarDto, actorId?: string): Promise<AmlSarReport> {
    const caseEntity = await this.caseRepository.findOne({
      where: { id: dto.caseId },
    });
    if (!caseEntity)
      throw new NotFoundException(`Case ${dto.caseId} not found`);
    const alerts = caseEntity.alertIds.length
      ? await this.alertRepository.find({
          where: { id: In(caseEntity.alertIds) },
        })
      : [];
    if (alerts.length === 0) {
      throw new BadRequestException(
        'A SAR requires at least one monitored alert on the case',
      );
    }

    const subject = caseEntity.subjectUserId
      ? await this.userRepository.findOne({
          where: { id: caseEntity.subjectUserId },
        })
      : null;

    const totalUsd = alerts.reduce(
      (total, alert) => total + Number(alert.amountUsd ?? 0),
      0,
    );
    const timestamps = alerts.map((alert) => alert.createdAt.getTime());
    const from = new Date(Math.min(...timestamps));
    const to = new Date(Math.max(...timestamps));

    const subjects = [
      {
        userId: caseEntity.subjectUserId,
        name: subject?.fullName ?? null,
        country: subject?.country ?? null,
        kycStatus: subject?.kycStatus ?? null,
        walletAddress: subject?.walletAddress ?? null,
        dateOfBirth: subject?.birthdate ?? null,
        role: subject?.role ?? null,
      },
    ];
    const activities = alerts.map((alert) => ({
      alertId: alert.id,
      patternType: alert.patternType,
      ruleCode: alert.ruleCode,
      amountUsd: Number(alert.amountUsd ?? 0),
      observedAt: alert.createdAt.toISOString(),
      dealId: alert.dealId,
      riskScore: Number(alert.riskScore),
      description: alert.matchReason,
    }));

    const sarNumber = await this.nextSarNumber();
    const narrative = this.buildNarrative({
      caseEntity,
      subject,
      alerts,
      totalUsd,
      from,
      to,
    });
    const jurisdiction = dto.jurisdiction ?? subject?.country ?? 'US';
    const authority = dto.authority ?? defaultAuthority(jurisdiction);
    const filingType = dto.filingType ?? 'initial';

    const draft = {
      sarNumber,
      jurisdiction,
      authority,
      filingType,
      subjects,
      activities,
      suspiciousAmountUsd: totalUsd,
      activityFrom: from,
      activityTo: to,
      narrative,
    };
    const sha256Hash = createHash('sha256')
      .update(this.canonicalPayload(draft))
      .digest('hex');

    const saved = await this.sarRepository.save(
      this.sarRepository.create({
        ...draft,
        caseId: caseEntity.id,
        status: 'draft',
        structuredData: {
          caseNumber: caseEntity.caseNumber,
          patterns: [...new Set(alerts.map((alert) => alert.patternType))],
          ruleCodes: [...new Set(alerts.map((alert) => alert.ruleCode))],
        },
        sha256Hash,
        version: 1,
        generatedBy: actorId ?? null,
      }),
    );

    await this.auditService.logEvent({
      actorId: actorId ?? null,
      route: 'POST /admin/aml/sar',
      statusCode: 201,
      requestDetails: {
        sarNumber,
        caseNumber: caseEntity.caseNumber,
        amountUsd: totalUsd,
      },
    });
    this.logger.log(`Generated ${sarNumber} from ${caseEntity.caseNumber}`);
    return saved;
  }

  async markReviewed(sarId: string, actorId?: string): Promise<AmlSarReport> {
    const report = await this.getSar(sarId);
    if (report.status !== 'draft') {
      throw new BadRequestException('Only draft reports can be reviewed');
    }
    report.status = 'reviewed';
    report.reviewedBy = actorId ?? null;
    report.reviewedAt = new Date();
    return this.sarRepository.save(report);
  }

  async getSar(id: string): Promise<AmlSarReport> {
    const found = await this.sarRepository.findOne({ where: { id } });
    if (!found) throw new NotFoundException(`SAR ${id} not found`);
    return found;
  }

  async listSars(status?: string, limit = 50): Promise<AmlSarReport[]> {
    return this.sarRepository.find({
      where: status ? { status: status as SarStatus } : {},
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  /** Verify that a filed report still matches the hash taken when it was generated. */
  async verifyIntegrity(
    sarId: string,
  ): Promise<{ valid: boolean; sha256Hash: string }> {
    const report = await this.getSar(sarId);
    const recomputed = createHash('sha256')
      .update(
        this.canonicalPayload({
          sarNumber: report.sarNumber,
          jurisdiction: report.jurisdiction,
          authority: report.authority,
          filingType: report.filingType,
          subjects: report.subjects,
          activities: report.activities,
          suspiciousAmountUsd: Number(report.suspiciousAmountUsd),
          activityFrom: report.activityFrom,
          activityTo: report.activityTo,
          narrative: report.narrative,
        }),
      )
      .digest('hex');
    return {
      valid: recomputed === report.sha256Hash,
      sha256Hash: report.sha256Hash,
    };
  }

  async analytics(): Promise<SarAnalytics> {
    const rows = await this.sarRepository
      .createQueryBuilder('sar')
      .select('sar.status', 'status')
      .addSelect('COUNT(1)', 'count')
      .addSelect('COALESCE(SUM(sar.suspicious_amount_usd), 0)', 'amount')
      .groupBy('sar.status')
      .getRawMany<{ status: string; count: string; amount: string }>();
    const byStatus: Record<string, number> = {};
    let amountUsd = 0;
    let total = 0;
    for (const row of rows) {
      byStatus[row.status] = Number(row.count);
      amountUsd += Number(row.amount);
      total += Number(row.count);
    }
    return {
      total,
      draft: byStatus.draft ?? 0,
      reviewed: byStatus.reviewed ?? 0,
      submitted: byStatus.submitted ?? 0,
      acknowledged: byStatus.acknowledged ?? 0,
      amountUsd: Math.round(amountUsd * 100) / 100,
    };
  }
}

/** FIU/authority implied by the filing jurisdiction; overridable per report. */
export function defaultAuthority(jurisdiction: string): string {
  const map: Record<string, string> = {
    US: 'FinCEN',
    EU: 'national FIU (EU member state)',
    GB: 'NCA',
    UK: 'NCA',
    NG: 'NFIU',
    KE: 'Financial Reporting Centre (Kenya)',
    GH: 'Financial Intelligence Centre (Ghana)',
  };
  return map[String(jurisdiction).toUpperCase()] ?? 'national FIU';
}
