import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFFont, rgb, StandardFonts } from 'pdf-lib';

export interface WatermarkOptions {
  dealId: string;
  date?: Date;
  requester: string;
  opacity?: number;
}

export interface WatermarkResult {
  buffer: Buffer;
  pageCount: number;
}

/**
 * WatermarkService adds an informational overlay to PDF documents.
 *
 * The overlay includes the deal id, the document creation date, and the
 * requester name — the three fields required by KYC / co-farmer compliance
 * policies (issue #1005).  Only PDF buffers are watermarked; non-PDF files
 * are passed through untouched so that PNG/JPEG uploads are unaffected.
 *
 * Uses pdf-lib (already available in the dependency tree) to draw semi-
 * transparent diagonal text across every page, then re-serialises the
 * document with object streams for a compact result.
 */
@Injectable()
export class WatermarkService {
  private embeddedFont: PDFFont | null = null;

  /**
   * Apply a diagonal watermark overlay to every page of a PDF buffer.
   * Non-PDF content is returned unchanged so image uploads are unaffected.
   *
   * Returns the watermarked buffer together with the page count.
   */
  async applyWatermark(
    input: Buffer,
    mimeType: string,
    options: WatermarkOptions,
  ): Promise<WatermarkResult> {
    if (mimeType !== 'application/pdf') {
      return { buffer: input, pageCount: 1 };
    }

    const opacity = Math.min(Math.max(options.opacity ?? 0.08, 0.02), 0.25);

    const pdfDoc = await PDFDocument.load(input, { ignoreEncryption: true });
    const pages = pdfDoc.getPages();
    const dateStr = (options.date ?? new Date()).toISOString().split('T')[0];
    const text = `Agri-fi — Deal: ${options.dealId} | Date: ${dateStr} | Requester: ${options.requester}`;
    const font = await this.getFont(pdfDoc);

    for (const page of pages) {
      const { width, height } = page.getSize();
      const fontSize = Math.min(width, height) * 0.022;
      const textWidth = font.widthOfTextAtSize(text, fontSize);

      page.drawText(text, {
        x: (width - textWidth) / 2,
        y: height / 2,
        size: fontSize,
        font,
        color: rgb(0.1, 0.1, 0.1),
        opacity,
        rotate: 45,
      });
    }

    const out = await pdfDoc.save({ useObjectStreams: true });
    return { buffer: Buffer.from(out), pageCount: pages.length };
  }

  /**
   * Regenerate a fresh in-memory PDF with a watermark, used for cases where
   * the original stored document needs to be re-processed (e.g. an earlier
   * upload skipped the watermark option).
   */
  async regenerateWithWatermark(
    input: Buffer,
    options: WatermarkOptions,
  ): Promise<WatermarkResult> {
    return this.applyWatermark(input, 'application/pdf', options);
  }

  /** Lazily embed a standard font so the watermark text is always available. */
  private async getFont(pdfDoc: PDFDocument): Promise<PDFFont> {
    if (!this.embeddedFont) {
      this.embeddedFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    }
    return this.embeddedFont;
  }
}
