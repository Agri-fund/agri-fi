/**
 * ComplianceReportService
 * Issue #872 — Compliance report generation for regulatory submissions.
 *
 * Generates:
 *  1. Monthly AML/KYC Summary  — new users, KYC approved/rejected/pending, OFAC hits
 *  2. Quarterly Transaction Report — investment volumes by country, avg deal size, payout totals
 *  3. Incident Report — any compliance alerts triggered in the period
 *
 * Reports are:
 *  - Rendered as PDF (pdf-lib)
 *  - Signed with a SHA-256 digest hash for tamper evidence
 *  - Uploaded to S3 under the "compliance/" prefix with strict access controls
 *  - Metadata persisted to compliance_reports DB table
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { Cron } from '@nestjs/schedule';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createHash } from 'crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { User } from '../auth/entities/user.entity';
import { Investment } from '../investments/entities/investment.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { ComplianceReport } from './entities/compliance-report.entity';
import { SystemAuditLog } from '../audit/entities/system-audit-log.entity';

export type ReportType = 'monthly_aml_kyc' | 'quarterly_transaction' | 'incident';

@Injectable()
export class ComplianceReportService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(TradeDeal)
    private readonly dealRepo: Repository<TradeDeal>,
    @InjectRepository(ComplianceReport)
    private readonly reportRepo: Repository<ComplianceReport>,
    @InjectRepository(SystemAuditLog)
    private readonly auditRepo: Repository<SystemAuditLog>,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
    private readonly dataSource: DataSource,
  ) {
    this.logger.setContext(ComplianceReportService.name);
    this.bucket = this.config.get<string>('AWS_S3_BUCKET', '');
    this.s3 = new S3Client({
      region: this.config.get<string>('AWS_REGION', 'us-east-1'),
    });
  }

  // ── Scheduled generation ─────────────────────────────────────────────────

  /** Monthly — 1st of every month at 01:00 UTC */
  @Cron('0 1 1 * *')
  async generateMonthlyScheduled(): Promise<void> {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end   = new Date(now.getFullYear(), now.getMonth(), 1);
    this.logger.info({ start, end }, 'Generating scheduled monthly AML/KYC report');
    await this.generateMonthly(start, end);
  }

  /** Quarterly — 1st of Jan, Apr, Jul, Oct at 02:00 UTC */
  @Cron('0 2 1 1,4,7,10 *')
  async generateQuarterlyScheduled(): Promise<void> {
    const now = new Date();
    const quarterStartMonth = Math.floor((now.getMonth()) / 3) * 3 - 3;
    const start = new Date(now.getFullYear(), quarterStartMonth, 1);
    const end   = new Date(now.getFullYear(), quarterStartMonth + 3, 1);
    this.logger.info({ start, end }, 'Generating scheduled quarterly transaction report');
    await this.generateQuarterly(start, end);
  }

  // ── Public API ───────────────────────────────────────────────────────────

  async generateMonthly(start: Date, end: Date): Promise<ComplianceReport> {
    this.logger.info({ start, end }, 'Generating monthly AML/KYC report');

    const [totalUsers, kycApproved, kycRejected, kycPending, ofacHits] =
      await Promise.all([
        this.userRepo.count({ where: { createdAt: Between(start, end) } as any }),
        this.userRepo.count({ where: { kycStatus: 'verified', updatedAt: Between(start, end) } as any }),
        this.userRepo.count({ where: { kycStatus: 'rejected', updatedAt: Between(start, end) } as any }),
        this.userRepo.count({ where: { kycStatus: 'pending' } }),
        this.countOfacHits(start, end),
      ]);

    const data = { totalUsers, kycApproved, kycRejected, kycPending, ofacHits, period: { start, end } };
    const title = `Monthly AML/KYC Summary — ${this.formatPeriod(start, end)}`;

    const pdf = await this.buildPdf(title, [
      ['Report Type', 'Monthly AML/KYC Summary'],
      ['Period', this.formatPeriod(start, end)],
      ['Generated At', new Date().toUTCString()],
      ['', ''],
      ['New Users Registered', String(totalUsers)],
      ['KYC Approved', String(kycApproved)],
      ['KYC Rejected', String(kycRejected)],
      ['KYC Pending', String(kycPending)],
      ['OFAC Screening Hits', String(ofacHits)],
    ]);

    return this.uploadAndPersist('monthly_aml_kyc', title, pdf, data, start, end);
  }

  async generateQuarterly(start: Date, end: Date): Promise<ComplianceReport> {
    this.logger.info({ start, end }, 'Generating quarterly transaction report');

    const investments = await this.investmentRepo.find({
      where: { status: 'confirmed', createdAt: Between(start, end) as any },
      relations: ['deal'],
    });

    const volumeByCountry: Record<string, number> = {};
    let totalVolume = 0;
    let totalPayouts = 0;

    for (const inv of investments) {
      const country = (inv as any).country ?? 'Unknown';
      volumeByCountry[country] = (volumeByCountry[country] ?? 0) + Number(inv.amount_usd ?? 0);
      totalVolume += Number(inv.amount_usd ?? 0);
    }

    const deals = await this.dealRepo.find({
      where: { status: 'completed', updatedAt: Between(start, end) as any },
    });
    totalPayouts = deals.reduce((s, d) => s + Number(d.totalValue ?? 0), 0);
    const avgDealSize = deals.length > 0 ? totalVolume / deals.length : 0;

    const data = { volumeByCountry, totalVolume, totalPayouts, avgDealSize, dealsCompleted: deals.length, period: { start, end } };
    const title = `Quarterly Transaction Report — ${this.formatPeriod(start, end)}`;

    const rows: [string, string][] = [
      ['Report Type', 'Quarterly Transaction Report'],
      ['Period', this.formatPeriod(start, end)],
      ['Generated At', new Date().toUTCString()],
      ['', ''],
      ['Total Investment Volume (USD)', `$${totalVolume.toLocaleString()}`],
      ['Deals Completed', String(deals.length)],
      ['Average Deal Size (USD)', `$${avgDealSize.toFixed(2)}`],
      ['Total Payout Volume (USD)', `$${totalPayouts.toLocaleString()}`],
      ['', ''],
      ['Investment Volume by Country', ''],
      ...Object.entries(volumeByCountry).map(([c, v]): [string, string] => [`  ${c}`, `$${v.toLocaleString()}`]),
    ];

    const pdf = await this.buildPdf(title, rows);
    return this.uploadAndPersist('quarterly_transaction', title, pdf, data, start, end);
  }

  async generateIncident(start: Date, end: Date): Promise<ComplianceReport> {
    const alerts = await this.auditRepo.find({
      where: { timestamp: Between(start, end) as any },
      order: { timestamp: 'DESC' },
      take: 500,
    });

    const complianceAlerts = alerts.filter(
      (a) => a.route?.includes('compliance') || a.route?.includes('kyc') || a.route?.includes('ofac'),
    );

    const title = `Incident Report — ${this.formatPeriod(start, end)}`;
    const rows: [string, string][] = [
      ['Report Type', 'Compliance Incident Report'],
      ['Period', this.formatPeriod(start, end)],
      ['Generated At', new Date().toUTCString()],
      ['', ''],
      ['Total Compliance Events', String(complianceAlerts.length)],
      ['', ''],
      ...complianceAlerts.slice(0, 50).map((a): [string, string] => [
        new Date(a.timestamp).toUTCString(),
        `${a.route} [${a.actorRole ?? 'system'}] status=${a.statusCode}`,
      ]),
    ];

    const pdf = await this.buildPdf(title, rows);
    return this.uploadAndPersist('incident', title, pdf, { alertCount: complianceAlerts.length }, start, end);
  }

  /** Returns list of available reports with signed S3 download URLs (15-min expiry). */
  async listReports(type?: ReportType): Promise<Array<ComplianceReport & { downloadUrl: string }>> {
    const where: any = {};
    if (type) where.reportType = type;

    const reports = await this.reportRepo.find({
      where,
      order: { generatedAt: 'DESC' },
      take: 50,
    });

    return Promise.all(
      reports.map(async (r) => {
        const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: r.s3Key });
        const downloadUrl = await getSignedUrl(this.s3, cmd, { expiresIn: 900 });
        return { ...r, downloadUrl };
      }),
    );
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async countOfacHits(start: Date, end: Date): Promise<number> {
    return this.auditRepo.count({
      where: {
        route: 'ofac_sanctioned' as any,
        timestamp: Between(start, end) as any,
        statusCode: 400,
      },
    });
  }

  private async buildPdf(title: string, rows: [string, string][]): Promise<Buffer> {
    const doc  = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);

    const { height } = page.getSize();
    let y = height - 60;

    // Title
    page.drawText(title, { x: 50, y, size: 16, font: bold, color: rgb(0.1, 0.4, 0.2) });
    y -= 10;
    page.drawLine({ start: { x: 50, y }, end: { x: 562, y }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
    y -= 20;

    for (const [label, value] of rows) {
      if (y < 80) {
        const extra = doc.addPage([612, 792]);
        y = 762;
      }
      if (!label && !value) { y -= 8; continue; }
      if (!value) {
        page.drawText(label, { x: 50, y, size: 10, font: bold, color: rgb(0.2, 0.2, 0.2) });
      } else {
        page.drawText(label, { x: 50, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
        page.drawText(value, { x: 300, y, size: 10, font, color: rgb(0, 0, 0) });
      }
      y -= 16;
    }

    const bytes = await doc.save();
    return Buffer.from(bytes);
  }

  private sha256(buf: Buffer): string {
    return createHash('sha256').update(buf).digest('hex');
  }

  private async uploadAndPersist(
    type: ReportType,
    title: string,
    pdf: Buffer,
    data: Record<string, unknown>,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<ComplianceReport> {
    const hash    = this.sha256(pdf);
    const ts      = new Date().toISOString().replace(/[:.]/g, '-');
    const s3Key   = `compliance/${type}/${ts}.pdf`;

    if (this.bucket) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket:      this.bucket,
          Key:         s3Key,
          Body:        pdf,
          ContentType: 'application/pdf',
          // Strict access: no public read, server-side encryption
          ServerSideEncryption: 'AES256',
          Metadata: {
            'report-type':  type,
            'sha256-digest': hash,
            'period-start': periodStart.toISOString(),
            'period-end':   periodEnd.toISOString(),
          },
        }),
      );
      this.logger.info({ s3Key, hash }, 'Compliance report uploaded to S3');
    } else {
      this.logger.warn('AWS_S3_BUCKET not configured — report not uploaded');
    }

    const report = this.reportRepo.create({
      reportType:  type,
      title,
      s3Key,
      sha256Hash:  hash,
      reportData:  data,
      periodStart,
      periodEnd,
      generatedAt: new Date(),
    });

    return this.reportRepo.save(report);
  }

  private formatPeriod(start: Date, end: Date): string {
    return `${start.toLocaleDateString('en', { month: 'short', year: 'numeric' })} – ${end.toLocaleDateString('en', { month: 'short', year: 'numeric' })}`;
  }
}
