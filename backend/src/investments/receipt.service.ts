import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import * as PDFDocument from 'pdfkit';
import { Investment } from './entities/investment.entity';

/** Pre-signed URL validity window: 15 minutes */
const PRESIGN_EXPIRES_SECONDS = 15 * 60;

export interface ReceiptResult {
  url: string;
  expiresAt: string;
}

@Injectable()
export class ReceiptService {
  private readonly logger = new Logger(ReceiptService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly region: string;

  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    private readonly config: ConfigService,
  ) {
    this.bucket = config.get<string>('AWS_S3_BUCKET', '');
    this.region = config.get<string>('AWS_REGION', 'us-east-1');

    this.s3 = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: config.get<string>('AWS_ACCESS_KEY_ID', ''),
        secretAccessKey: config.get<string>('AWS_SECRET_ACCESS_KEY', ''),
      },
    });
  }

  /**
   * Generate (or return a cached) PDF receipt for the given investment.
   *
   * @param investmentId - UUID of the investment
   * @param userId       - ID of the authenticated user (must own the investment)
   * @returns Pre-signed S3 URL valid for 15 minutes + ISO expiry string
   */
  async generateReceipt(
    investmentId: string,
    userId: string,
  ): Promise<ReceiptResult> {
    // ------------------------------------------------------------------
    // 1. Load investment (with trade deal relation for deal metadata)
    // ------------------------------------------------------------------
    const investment = await this.investmentRepo.findOne({
      where: { id: investmentId },
      relations: ['tradeDeal', 'investor'],
    });

    if (!investment) {
      throw new NotFoundException(`Investment ${investmentId} not found.`);
    }

    if (investment.investorId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to access this receipt.',
      );
    }

    const s3Key = `receipts/${investmentId}.pdf`;

    // ------------------------------------------------------------------
    // 2. Cache-hit: if the object already exists in S3, just re-sign it
    // ------------------------------------------------------------------
    const cached = await this.s3ObjectExists(s3Key);
    if (cached) {
      this.logger.log(`Receipt cache hit for investment ${investmentId}`);
      return this.buildPresignedResult(s3Key);
    }

    // ------------------------------------------------------------------
    // 3. Generate PDF buffer
    // ------------------------------------------------------------------
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await this.buildPdfBuffer(investment);
    } catch (err) {
      this.logger.error(
        `PDF generation failed for investment ${investmentId}: ${err.message}`,
      );
      throw new InternalServerErrorException(
        'PDF receipt generation failed. Please try again.',
      );
    }

    // ------------------------------------------------------------------
    // 4. Upload to S3
    // ------------------------------------------------------------------
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
          Body: pdfBuffer,
          ContentType: 'application/pdf',
          // Prevent direct public access — access via pre-signed URL only
          ServerSideEncryption: 'AES256',
        }),
      );
    } catch (err) {
      this.logger.error(
        `S3 upload failed for receipt ${s3Key}: ${err.message}`,
      );
      throw new InternalServerErrorException(
        'Failed to store receipt. Please try again.',
      );
    }

    // ------------------------------------------------------------------
    // 5. Persist receipt metadata on the investment record
    // ------------------------------------------------------------------
    try {
      await this.investmentRepo.update(investment.id, {
        receiptUrl: `s3://${this.bucket}/${s3Key}`,
        receiptGeneratedAt: new Date(),
      });
    } catch (err) {
      // Non-fatal: log and continue — the PDF is already in S3
      this.logger.warn(
        `Failed to update investment receipt metadata for ${investmentId}: ${err.message}`,
      );
    }

    return this.buildPresignedResult(s3Key);
  }

  // --------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------

  /**
   * Returns true when the given S3 key already exists (HeadObject succeeds).
   */
  private async s3ObjectExists(key: string): Promise<boolean> {
    try {
      await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Builds a pre-signed GetObject URL valid for PRESIGN_EXPIRES_SECONDS.
   */
  private async buildPresignedResult(key: string): Promise<ReceiptResult> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const url = await getSignedUrl(this.s3, command, {
      expiresIn: PRESIGN_EXPIRES_SECONDS,
    });
    const expiresAt = new Date(
      Date.now() + PRESIGN_EXPIRES_SECONDS * 1000,
    ).toISOString();
    return { url, expiresAt };
  }

  /**
   * Generates the PDF receipt as a Buffer using PDFKit.
   *
   * Included fields:
   *   - Platform branding header
   *   - Investment ID
   *   - Deal name and commodity
   *   - Amount USD and token count
   *   - Investment date
   *   - Stellar transaction hash (if confirmed)
   */
  private buildPdfBuffer(investment: Investment): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const deal = investment.tradeDeal;
      const dealName = deal?.title ?? investment.tradeDealId;
      const commodity =
        ((deal as Record<string, unknown>)?.['commodity'] as string) ?? 'N/A';
      const amountUsd = Number(investment.amountUsd ?? 0).toFixed(2);
      const tokenCount = investment.tokenAmount ?? 0;
      const investmentDate = (investment.createdAt ?? new Date())
        .toISOString()
        .slice(0, 10);
      const txHash = investment.stellarTxId ?? 'Pending';

      // ---- Header ----
      doc
        .fillColor('#1a6b3c')
        .fontSize(22)
        .font('Helvetica-Bold')
        .text('Agri-Fi Platform', { align: 'center' });

      doc
        .fillColor('#444444')
        .fontSize(14)
        .font('Helvetica')
        .text('Investment Payment Receipt', { align: 'center' });

      doc.moveDown(0.5);
      doc
        .strokeColor('#1a6b3c')
        .lineWidth(1.5)
        .moveTo(50, doc.y)
        .lineTo(545, doc.y)
        .stroke();
      doc.moveDown(1);

      // ---- Body: two-column label/value layout ----
      const labelX = 50;
      const valueX = 220;
      const rowHeight = 24;

      const rows: [string, string][] = [
        ['Receipt Date:', new Date().toISOString().slice(0, 10)],
        ['Investment ID:', investment.id],
        ['Deal Name:', dealName],
        ['Commodity:', commodity],
        ['Amount (USD):', `$${amountUsd}`],
        ['Tokens Purchased:', tokenCount.toString()],
        ['Investment Date:', investmentDate],
        ['Stellar Tx Hash:', txHash],
      ];

      for (const [label, value] of rows) {
        const y = doc.y;

        doc
          .fillColor('#555555')
          .font('Helvetica-Bold')
          .fontSize(11)
          .text(label, labelX, y);

        doc
          .fillColor('#111111')
          .font('Helvetica')
          .fontSize(11)
          .text(value, valueX, y, { width: 325, ellipsis: true });

        doc.y = y + rowHeight;
      }

      doc.moveDown(1.5);

      // ---- Footer ----
      doc
        .strokeColor('#cccccc')
        .lineWidth(0.5)
        .moveTo(50, doc.y)
        .lineTo(545, doc.y)
        .stroke();
      doc.moveDown(0.5);

      doc
        .fillColor('#888888')
        .fontSize(9)
        .font('Helvetica')
        .text(
          'This receipt is generated automatically by Agri-Fi Platform. ' +
            'For queries, contact support@agri-fi.com.',
          { align: 'center' },
        );

      doc.end();
    });
  }
}
