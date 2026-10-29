import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { AmlRegulatorySubmission } from './entities/aml-regulatory-submission.entity';
import { AmlSarReport } from './entities/aml-sar-report.entity';
import { SubmitSarDto } from './dto/aml-monitoring.dto';
import { RegulatorySubmissionStatus } from './aml.constants';
import { AuditService } from '../audit/audit.service';

export interface SubmissionResult {
  submissionId: string;
  submissionNumber: string;
  status: string;
  channel: string;
  authorityReference: string | null;
  message: string;
}

/**
 * Regulatory reporting (#1217): getting a filed SAR to the Financial
 * Intelligence Unit and keeping the receipt.
 *
 * The record is written *before* the transport is attempted, so an authority
 * endpoint being down can never lose a filing. When no endpoint is configured
 * (every deployment that has not yet onboarded with its FIU's gateway) the
 * submission is recorded as a manual portal filing rather than pretending an
 * API call happened.
 */
@Injectable()
export class RegulatoryReportingService {
  private readonly logger = new Logger(RegulatoryReportingService.name);

  constructor(
    @InjectRepository(AmlRegulatorySubmission)
    private readonly submissionRepository: Repository<AmlRegulatorySubmission>,
    @InjectRepository(AmlSarReport)
    private readonly sarRepository: Repository<AmlSarReport>,
    private readonly config: ConfigService,
    private readonly auditService: AuditService,
  ) {}

  private get endpoint(): string {
    return String(this.config.get('AML_REGULATORY_REPORTING_URL', '') ?? '');
  }

  private get apiKey(): string {
    return String(
      this.config.get('AML_REGULATORY_REPORTING_API_KEY', '') ?? '',
    );
  }

  private get enabled(): boolean {
    return (
      String(
        this.config.get('AML_REGULATORY_REPORTING_ENABLED', 'false'),
      ).toLowerCase() === 'true'
    );
  }

  private get timeoutMs(): number {
    return Number(
      this.config.get('AML_REGULATORY_REPORTING_TIMEOUT_MS', '15000'),
    );
  }

  private async nextSubmissionNumber(): Promise<string> {
    const year = new Date().getUTCFullYear();
    const prefix = `SUB-${year}-`;
    const count = await this.submissionRepository
      .createQueryBuilder('submission')
      .where('submission.submissionNumber LIKE :prefix', {
        prefix: `${prefix}%`,
      })
      .getCount();
    return `${prefix}${String(count + 1).padStart(6, '0')}`;
  }

  /** The wire payload: everything a filing needs, nothing that identifies the filer's customers to a third party. */
  private buildPayload(report: AmlSarReport): Record<string, unknown> {
    return {
      sarNumber: report.sarNumber,
      jurisdiction: report.jurisdiction,
      authority: report.authority,
      filingType: report.filingType,
      subjects: report.subjects,
      activities: report.activities,
      suspiciousAmountUsd: Number(report.suspiciousAmountUsd),
      activityFrom: report.activityFrom?.toISOString?.() ?? null,
      activityTo: report.activityTo?.toISOString?.() ?? null,
      narrative: report.narrative,
      contentHash: report.sha256Hash,
      generatedAt: report.createdAt.toISOString(),
    };
  }

  async submit(dto: SubmitSarDto, actorId?: string): Promise<SubmissionResult> {
    const report = await this.sarRepository.findOne({
      where: { id: dto.sarReportId },
    });
    if (!report)
      throw new NotFoundException(`SAR ${dto.sarReportId} not found`);
    if (report.status === 'draft') {
      throw new BadRequestException(
        'A report must be reviewed by an officer before it can be filed',
      );
    }
    if (report.status === 'submitted' || report.status === 'acknowledged') {
      throw new BadRequestException('This report has already been filed');
    }

    const submissionNumber = await this.nextSubmissionNumber();
    const payload = this.buildPayload(report);
    const manual =
      dto.manualFiling === true ||
      !this.enabled ||
      !this.endpoint ||
      !this.apiKey;
    const channel = manual ? 'manual_secure_portal' : 'api';

    let submission = await this.submissionRepository.save(
      this.submissionRepository.create({
        submissionNumber,
        reportType: 'sar',
        reportId: report.id,
        authority: report.authority,
        channel,
        status: 'pending',
        attempt: 1,
        requestSummary: {
          sarNumber: report.sarNumber,
          amountUsd: Number(report.suspiciousAmountUsd),
          subjectCount: report.subjects.length,
          contentHash: report.sha256Hash,
          notes: dto.notes ?? null,
          transportConfigured: !manual,
        },
        submittedBy: actorId ?? null,
      }),
    );

    if (manual) {
      const message =
        dto.manualFiling === true
          ? 'Recorded as a manual filing on the authority portal.'
          : 'No regulatory reporting endpoint is configured; the filing must be made through the authority portal.';
      this.logger.warn(`${submissionNumber}: ${message}`);
      await this.auditService.logEvent({
        actorId: actorId ?? null,
        route: 'POST /admin/aml/sar/submit',
        statusCode: 202,
        requestDetails: { submissionNumber, channel, message },
      });
      return {
        submissionId: submission.id,
        submissionNumber,
        status: 'pending',
        channel,
        authorityReference: null,
        message,
      };
    }

    try {
      const response = await axios.post(
        this.endpoint,
        { ...payload, notes: dto.notes ?? null },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.apiKey,
            'X-Filing-Authority': report.authority,
          },
          timeout: this.timeoutMs,
        },
      );
      const reference =
        response.data?.reference ??
        response.data?.submissionId ??
        response.data?.id ??
        null;
      submission = await this.submissionRepository.save({
        ...submission,
        status: 'accepted',
        authorityReference: reference ? String(reference) : null,
        response: sanitizeResponse(response.data),
        submittedAt: new Date(),
      });
      await this.sarRepository.update(
        { id: report.id },
        { status: 'submitted', filedAt: new Date() },
      );
      await this.auditService.logEvent({
        actorId: actorId ?? null,
        route: 'POST /admin/aml/sar/submit',
        statusCode: 200,
        requestDetails: { submissionNumber, authorityReference: reference },
      });
      return {
        submissionId: submission.id,
        submissionNumber,
        status: 'accepted',
        channel,
        authorityReference: reference ? String(reference) : null,
        message: 'Report filed with the authority.',
      };
    } catch (error) {
      const axiosError = error as {
        message: string;
        response?: { status?: number; data?: unknown };
      };
      const status =
        axiosError.response &&
        Number(axiosError.response.status) >= 400 &&
        Number(axiosError.response.status) < 500
          ? 'rejected'
          : 'failed';
      submission = await this.submissionRepository.save({
        ...submission,
        status,
        response: sanitizeResponse(
          axiosError.response?.data ?? { error: axiosError.message },
        ),
      });
      this.logger.error(`${submissionNumber} ${status}: ${axiosError.message}`);
      return {
        submissionId: submission.id,
        submissionNumber,
        status,
        channel,
        authorityReference: null,
        message:
          status === 'rejected'
            ? 'The authority rejected the filing; correct and re-file.'
            : 'Filing could not be completed; the submission is queued for retry.',
      };
    }
  }

  /** Retry an earlier failed submission, bumping the attempt counter. */
  async retry(
    submissionId: string,
    actorId?: string,
  ): Promise<SubmissionResult> {
    const previous = await this.submissionRepository.findOne({
      where: { id: submissionId },
    });
    if (!previous)
      throw new NotFoundException(`Submission ${submissionId} not found`);
    if (previous.status === 'accepted') {
      throw new BadRequestException('Submission was already accepted');
    }
    const report = await this.sarRepository.findOne({
      where: { id: previous.reportId },
    });
    if (!report)
      throw new NotFoundException(
        'The report behind this submission is missing',
      );

    await this.submissionRepository.update(
      { id: submissionId },
      { status: 'failed', attempt: previous.attempt + 1 },
    );
    // Re-filing reuses the same reviewed report; the SAR must be re-opened for
    // filing by clearing its submitted state only when it never reached the FIU.
    if (report.status === 'submitted') {
      await this.sarRepository.update(
        { id: report.id },
        { status: 'reviewed', filedAt: null },
      );
    }
    return this.submit({ sarReportId: previous.reportId }, actorId);
  }

  async markAcknowledged(
    submissionId: string,
    authorityReference: string | null,
    actorId?: string,
  ): Promise<AmlRegulatorySubmission> {
    const submission = await this.submissionRepository.findOne({
      where: { id: submissionId },
    });
    if (!submission)
      throw new NotFoundException(`Submission ${submissionId} not found`);
    submission.status = 'accepted';
    submission.authorityReference =
      authorityReference ?? submission.authorityReference;
    submission.submittedAt = submission.submittedAt ?? new Date();
    const saved = await this.submissionRepository.save(submission);
    await this.sarRepository.update(
      { id: submission.reportId },
      { status: 'acknowledged', filedAt: submission.submittedAt ?? new Date() },
    );
    await this.auditService.logEvent({
      actorId: actorId ?? null,
      route: 'POST /admin/aml/submissions/acknowledge',
      statusCode: 200,
      requestDetails: {
        submissionNumber: submission.submissionNumber,
        authorityReference,
      },
    });
    return saved;
  }

  async listSubmissions(
    status?: string,
    limit = 50,
  ): Promise<{ items: AmlRegulatorySubmission[]; total: number }> {
    const take = Math.min(Math.max(limit, 1), 200);
    const [items, total] = await this.submissionRepository.findAndCount({
      where: status ? { status: status as RegulatorySubmissionStatus } : {},
      order: { createdAt: 'DESC' },
      take,
    });
    return { items, total };
  }

  /** Pending/failed filings the cron retries. */
  async dueForRetry(limit = 20): Promise<AmlRegulatorySubmission[]> {
    return this.submissionRepository.find({
      where: [{ status: 'pending' }, { status: 'failed' }],
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  async reportingMetrics(): Promise<{
    byStatus: Record<string, number>;
    acceptanceRate: number;
    outstanding: number;
  }> {
    const rows = await this.submissionRepository
      .createQueryBuilder('submission')
      .select('submission.status', 'status')
      .addSelect('COUNT(1)', 'count')
      .groupBy('submission.status')
      .getRawMany<{ status: string; count: string }>();
    const byStatus: Record<string, number> = {};
    for (const row of rows) byStatus[row.status] = Number(row.count);
    const total = Object.values(byStatus).reduce(
      (sum, count) => sum + count,
      0,
    );
    return {
      byStatus,
      acceptanceRate: total > 0 ? (byStatus.accepted ?? 0) / total : 0,
      outstanding: (byStatus.pending ?? 0) + (byStatus.failed ?? 0),
    };
  }
}

/**
 * Keep responses small and free of anything that looks like a credential when
 * storing them next to a filing.
 */
export function sanitizeResponse(data: unknown): Record<string, unknown> {
  if (data === null || typeof data !== 'object') {
    return { detail: String(data ?? '') };
  }
  const source = data as Record<string, unknown>;
  const allowed = [
    'reference',
    'submissionId',
    'id',
    'status',
    'message',
    'code',
  ];
  const result: Record<string, unknown> = {};
  for (const key of allowed) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
}
