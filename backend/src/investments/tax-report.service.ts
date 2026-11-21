import { Injectable, Logger, NotFoundException } from '@nestjs/common';

export { TaxReportFormat } from './dto/tax-report-query.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  PutObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
// `export =` typings and no esModuleInterop: a default import is undefined at runtime.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFDocument = require('pdfkit');
import { Investment, InvestmentStatus } from './entities/investment.entity';
import { User } from '../auth/entities/user.entity';
import { QueueService } from '../queue/queue.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Queue routing key consumed by TaxStatementConsumer (#1298). */
export const TAX_STATEMENT_GENERATE = 'tax-statement.generate';

/** Portfolios with more confirmed investments than this are generated in the background. */
export const DEFAULT_TAX_STATEMENT_ASYNC_THRESHOLD = 500;

/** Download link validity for emailed statements (24 h). */
const STATEMENT_LINK_TTL_SECONDS = 24 * 60 * 60;

export interface TaxStatementRow {
  investmentId: string;
  dealId: string;
  dealName: string;
  date: string;
  tokenQuantity: number;
  investedUsd: number;
  returnedUsd: number;
  feesUsd: number;
  netUsd: number;
  /** `income` = realised gain on the deal, `capital_loss` = principal not recovered. */
  category: 'income' | 'capital_loss' | 'capital_return';
}

export interface TaxStatementTotals {
  tokenQuantity: number;
  investedUsd: number;
  returnedUsd: number;
  feesUsd: number;
  incomeUsd: number;
  capitalLossUsd: number;
  netUsd: number;
}

export interface TaxStatementData {
  year: number;
  investorId: string;
  investorName: string;
  rows: TaxStatementRow[];
  totals: TaxStatementTotals;
  generatedAt: string;
  disclaimer: string;
}

export type TaxStatementResult =
  | { queued: false; pdf: Buffer; filename: string }
  | { queued: true; year: number };

export interface TaxStatementJobPayload {
  investorId: string;
  year: number;
}

export interface TaxReportRow {
  dealName: string;
  investedAmount: string;
  returnReceived: string;
  netGainLoss: string;
  feesUsd: string;
  currency: string;
  closedAt: string;
}

export interface TaxReportData {
  year: number;
  investorId: string;
  rows: TaxReportRow[];
  totals: { currency: string; netGainLoss: number }[];
  generatedAt: string;
  disclaimer: string;
}

@Injectable()
export class TaxReportService {
  private readonly logger = new Logger(TaxReportService.name);
  private s3?: S3Client;

  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly queueService: QueueService,
    private readonly notificationsService: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async buildReportData(
    investorId: string,
    year: number,
  ): Promise<TaxReportData> {
    const start = new Date(`${year}-01-01T00:00:00Z`);
    const end = new Date(`${year + 1}-01-01T00:00:00Z`);

    const investments = await this.investmentRepo
      .createQueryBuilder('inv')
      .leftJoinAndSelect('inv.tradeDeal', 'deal')
      .where('inv.investorId = :investorId', { investorId })
      .andWhere('inv.status = :status', { status: InvestmentStatus.CONFIRMED })
      .andWhere('inv.createdAt >= :start', { start })
      .andWhere('inv.createdAt < :end', { end })
      .orderBy('inv.createdAt', 'ASC')
      .getMany();

    const rows: TaxReportRow[] = investments.map((inv) => {
      const invested = parseFloat(inv.amountUsd ?? '0');
      const returned = parseFloat(
        ((inv as Record<string, unknown>)['returnAmountUsd'] as string) ?? '0',
      );
      const fees = parseFloat(
        ((inv as Record<string, unknown>)['feesUsd'] as string) ?? '0',
      );
      const net = returned - invested - fees;
      return {
        dealName: inv.tradeDeal?.title ?? inv.tradeDealId,
        investedAmount: invested.toFixed(2),
        returnReceived: returned.toFixed(2),
        netGainLoss: net.toFixed(2),
        feesUsd: fees.toFixed(2),
        currency: 'USD',
        closedAt: inv.createdAt.toISOString().slice(0, 10),
      };
    });

    const totals = [
      {
        currency: 'USD',
        netGainLoss: rows.reduce(
          (sum, r) => sum + parseFloat(r.netGainLoss),
          0,
        ),
      },
    ];

    return {
      year,
      investorId,
      rows,
      totals,
      generatedAt: new Date().toISOString(),
      disclaimer:
        'This report is provided for informational purposes only and does not constitute professional tax advice. Consult a qualified tax advisor.',
    };
  }

  toCsv(report: TaxReportData): string {
    const headers = [
      'Deal Name',
      'Invested Amount (USD)',
      'Return Received (USD)',
      'Net Gain/Loss (USD)',
      'Fees (USD)',
      'Currency',
      'Closed At',
    ];
    const lines = [headers.join(',')];

    for (const row of report.rows) {
      lines.push(
        [
          `"${row.dealName.replace(/"/g, '""')}"`,
          row.investedAmount,
          row.returnReceived,
          row.netGainLoss,
          row.feesUsd,
          row.currency,
          row.closedAt,
        ].join(','),
      );
    }

    for (const total of report.totals) {
      lines.push(
        `"TOTAL (${total.currency})",,,${total.netGainLoss.toFixed(2)},,${total.currency},`,
      );
    }

    lines.push('');
    lines.push(`"${report.disclaimer}"`);
    return lines.join('\r\n');
  }

  // ── PDF tax statement (#1298) ──────────────────────────────────────────────

  private confirmedInvestmentsQuery(investorId: string, year: number) {
    const start = new Date(`${year}-01-01T00:00:00Z`);
    const end = new Date(`${year + 1}-01-01T00:00:00Z`);
    return this.investmentRepo
      .createQueryBuilder('inv')
      .where('inv.investorId = :investorId', { investorId })
      .andWhere('inv.status = :status', { status: InvestmentStatus.CONFIRMED })
      .andWhere('inv.createdAt >= :start', { start })
      .andWhere('inv.createdAt < :end', { end });
  }

  private get asyncThreshold(): number {
    return Number(
      this.config.get<number>(
        'TAX_STATEMENT_ASYNC_THRESHOLD',
        DEFAULT_TAX_STATEMENT_ASYNC_THRESHOLD,
      ),
    );
  }

  /**
   * Build the structured data for the PDF: investor, deal IDs, token
   * quantities, USD amounts and the income / capital breakdown.
   */
  async buildStatementData(
    investorId: string,
    year: number,
  ): Promise<TaxStatementData> {
    const investor = await this.userRepo.findOne({ where: { id: investorId } });
    if (!investor) {
      throw new NotFoundException(`Investor ${investorId} not found.`);
    }

    const investments = await this.confirmedInvestmentsQuery(investorId, year)
      .leftJoinAndSelect('inv.tradeDeal', 'deal')
      .orderBy('inv.createdAt', 'ASC')
      .getMany();

    const rows: TaxStatementRow[] = investments.map((inv) => {
      const extra = inv as unknown as Record<string, unknown>;
      const invested = parseFloat(String(inv.amountUsd ?? '0'));
      const returned = parseFloat(String(extra['returnAmountUsd'] ?? '0'));
      const fees = parseFloat(String(extra['feesUsd'] ?? '0'));
      const net = returned - invested - fees;
      return {
        investmentId: inv.id,
        dealId: inv.tradeDealId,
        dealName: inv.tradeDeal?.title ?? inv.tradeDealId,
        date: inv.createdAt.toISOString().slice(0, 10),
        tokenQuantity: Number(inv.tokenAmount ?? 0),
        investedUsd: invested,
        returnedUsd: returned,
        feesUsd: fees,
        netUsd: net,
        category:
          net > 0 ? 'income' : net < 0 ? 'capital_loss' : 'capital_return',
      };
    });

    const sum = (pick: (r: TaxStatementRow) => number) =>
      rows.reduce((acc, r) => acc + pick(r), 0);

    return {
      year,
      investorId,
      investorName:
        investor.companyDetails?.companyName?.trim() || investor.email,
      rows,
      totals: {
        tokenQuantity: sum((r) => r.tokenQuantity),
        investedUsd: sum((r) => r.investedUsd),
        returnedUsd: sum((r) => r.returnedUsd),
        feesUsd: sum((r) => r.feesUsd),
        incomeUsd: sum((r) => (r.category === 'income' ? r.netUsd : 0)),
        capitalLossUsd: sum((r) =>
          r.category === 'capital_loss' ? -r.netUsd : 0,
        ),
        netUsd: sum((r) => r.netUsd),
      },
      generatedAt: new Date().toISOString(),
      disclaimer:
        'This statement is provided for informational purposes only and does not constitute professional tax advice. Consult a qualified tax advisor.',
    };
  }

  /** Render the statement as a PDF document using PDFKit. */
  renderStatementPdf(data: TaxStatementData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const usd = (n: number) =>
        `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const left = doc.page.margins.left;
      const width =
        doc.page.width - doc.page.margins.left - doc.page.margins.right;

      doc
        .fontSize(20)
        .text('Agri-Fi Investment Tax Statement', { align: 'center' });
      doc.moveDown(0.3);
      doc.fontSize(12).text(`Tax year: ${data.year}`, { align: 'center' });
      doc.moveDown();

      doc.fontSize(10);
      doc.text(`Investor: ${data.investorName}`);
      doc.text(`Investor ID: ${data.investorId}`);
      doc.text(`Generated: ${data.generatedAt}`);
      doc.moveDown();

      const t = data.totals;
      doc.fontSize(12).text('Summary', { underline: true });
      doc.fontSize(10);
      doc.text(`Total invested: ${usd(t.investedUsd)}`);
      doc.text(`Total returned: ${usd(t.returnedUsd)}`);
      doc.text(`Fees paid: ${usd(t.feesUsd)}`);
      doc.text(`Token quantity: ${t.tokenQuantity}`);
      doc.moveDown(0.5);
      doc.text('Income / capital gains breakdown', { underline: true });
      doc.text(`Income (realised gain on deals): ${usd(t.incomeUsd)}`);
      doc.text(
        `Capital loss (principal not recovered): ${usd(t.capitalLossUsd)}`,
      );
      doc.text(`Net gain / (loss): ${usd(t.netUsd)}`);
      doc.moveDown();

      doc.fontSize(12).text('Investments', { underline: true });
      doc.moveDown(0.3);

      const cols = [
        { label: 'Date', w: 0.12 },
        { label: 'Deal ID', w: 0.26 },
        { label: 'Tokens', w: 0.1 },
        { label: 'Invested', w: 0.13 },
        { label: 'Returned', w: 0.13 },
        { label: 'Net', w: 0.13 },
        { label: 'Type', w: 0.13 },
      ];
      const drawRow = (cells: string[], bold = false) => {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 20) {
          doc.addPage();
        }
        const y = doc.y;
        let x = left;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        cols.forEach((c, i) => {
          doc.text(cells[i], x, y, {
            width: c.w * width - 4,
            lineBreak: false,
          });
          x += c.w * width;
        });
        doc.y = y + 14;
        doc.x = left;
      };

      drawRow(
        cols.map((c) => c.label),
        true,
      );
      const typeLabel = {
        income: 'Income',
        capital_loss: 'Capital loss',
        capital_return: 'Capital return',
      } as const;
      for (const r of data.rows) {
        drawRow([
          r.date,
          r.dealId,
          String(r.tokenQuantity),
          usd(r.investedUsd),
          usd(r.returnedUsd),
          usd(r.netUsd),
          typeLabel[r.category],
        ]);
      }
      if (data.rows.length === 0) {
        doc
          .font('Helvetica')
          .fontSize(9)
          .text('No confirmed investments in this tax year.', left, doc.y);
      }

      doc.moveDown();
      doc
        .font('Helvetica-Oblique')
        .fontSize(8)
        .text(data.disclaimer, left, doc.y, { width });
      doc.end();
    });
  }

  /**
   * Generate the PDF inline for normal portfolios, or queue a background job
   * (PDF emailed as a download link) for large ones.
   */
  async requestStatement(
    investorId: string,
    year: number,
  ): Promise<TaxStatementResult> {
    const count = await this.confirmedInvestmentsQuery(
      investorId,
      year,
    ).getCount();

    if (count > this.asyncThreshold) {
      const payload: TaxStatementJobPayload = { investorId, year };
      await this.queueService.emit(TAX_STATEMENT_GENERATE, payload);
      return { queued: true, year };
    }

    const data = await this.buildStatementData(investorId, year);
    const pdf = await this.renderStatementPdf(data);
    return { queued: false, pdf, filename: `tax-statement-${year}.pdf` };
  }

  /**
   * Background path: generate the PDF, store it in S3 and email a time-limited
   * download link to the investor.
   */
  async generateAndEmailStatement(
    payload: TaxStatementJobPayload,
  ): Promise<{ key: string; url: string }> {
    const { investorId, year } = payload;
    const investor = await this.userRepo.findOne({ where: { id: investorId } });
    if (!investor) {
      throw new NotFoundException(`Investor ${investorId} not found.`);
    }
    const data = await this.buildStatementData(investorId, year);
    const pdf = await this.renderStatementPdf(data);

    const bucket = this.config.get<string>('AWS_S3_BUCKET', '');
    const key = `tax-statements/${investorId}/tax-statement-${year}.pdf`;
    const s3 = this.getS3();
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: pdf,
        ContentType: 'application/pdf',
        ServerSideEncryption: 'AES256',
      }),
    );
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="tax-statement-${year}.pdf"`,
      }),
      { expiresIn: STATEMENT_LINK_TTL_SECONDS },
    );

    await this.notificationsService.sendEmail(
      investor.email,
      `Your ${year} Agri-Fi tax statement is ready`,
      `Your ${year} investment tax statement has been generated.\n\n` +
        `Download it here (link valid for 24 hours): ${url}\n`,
      `<p>Your ${year} investment tax statement has been generated.</p>` +
        `<p><a href="${url}">Download the PDF</a> (link valid for 24 hours).</p>`,
    );
    this.logger.log(`Tax statement ${year} emailed for investor ${investorId}`);
    return { key, url };
  }

  private getS3(): S3Client {
    this.s3 ??= new S3Client({
      region: this.config.get<string>('AWS_REGION', 'us-east-1'),
      credentials: {
        accessKeyId: this.config.get<string>('AWS_ACCESS_KEY_ID', ''),
        secretAccessKey: this.config.get<string>('AWS_SECRET_ACCESS_KEY', ''),
      },
    });
    return this.s3;
  }
}
