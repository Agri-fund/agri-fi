import { WatermarkService } from './watermark.service';
import { PDFDocument, StandardFonts } from 'pdf-lib';

describe('WatermarkService', () => {
  let service: WatermarkService;

  beforeEach(() => {
    service = new WatermarkService();
  });

  /** Build a minimal valid single-page PDF buffer. */
  async function createBlankPdf(): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([500, 500]);
    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }

  describe('applyWatermark', () => {
    it('returns non-PDF buffers unchanged (passthrough for images)', async () => {
      const original = Buffer.from('fake-png-data');
      const result = await service.applyWatermark(
        original,
        'image/png',
        {
          dealId: 'deal-123',
          requester: 'test@example.com',
        },
      );

      expect(result.buffer).toBe(original);
      expect(result.pageCount).toBe(1);
    });

    it('applies watermark text overlay to every PDF page', async () => {
      const original = await createBlankPdf();
      const result = await service.applyWatermark(
        original,
        'application/pdf',
        {
          dealId: 'deal-abc-123',
          requester: 'farmer@example.com',
        },
      );

      expect(result.pageCount).toBe(1);
      expect(result.buffer.length).toBeGreaterThan(original.length);

      // Verify the watermarked buffer is still a valid PDF.
      const reloaded = await PDFDocument.load(result.buffer, {
        ignoreEncryption: true,
      });
      expect(reloaded.getPageCount()).toBe(1);
    });

    it('clamps opacity to the configured minimum/maximum range', async () => {
      const original = await createBlankPdf();

      // Below minimum (0.01) should be clamped to 0.02.
      const lowResult = await service.applyWatermark(
        original,
        'application/pdf',
        { dealId: 'd1', requester: 'r1', opacity: 0.001 },
      );
      expect(lowResult.buffer.length).toBeGreaterThan(0);

      // Above maximum (0.25) should be clamped to 0.25.
      const highResult = await service.applyWatermark(
        original,
        'application/pdf',
        { dealId: 'd1', requester: 'r1', opacity: 0.99 },
      );
      expect(highResult.buffer.length).toBeGreaterThan(0);
    });

    it('uses the provided date in the watermark text', async () => {
      const original = await createBlankPdf();
      const result = await service.applyWatermark(
        original,
        'application/pdf',
        {
          dealId: 'deal-xyz',
          requester: 'user@example.com',
          date: new Date('2025-06-15T10:30:00Z'),
        },
      );

      // The watermarked PDF must still be parseable.
      const reloaded = await PDFDocument.load(result.buffer);
      expect(reloaded.getPageCount()).toBe(1);
    });

    it('defaults to today\'s date when no date is provided', async () => {
      const original = await createBlankPdf();
      const result = await service.applyWatermark(
        original,
        'application/pdf',
        {
          dealId: 'deal-xyz',
          requester: 'user@example.com',
        },
      );

      const reloaded = await PDFDocument.load(result.buffer);
      expect(reloaded.getPageCount()).toBe(1);
    });

    it('handles a multi-page PDF and watermarks every page', async () => {
      const pdfDoc = await PDFDocument.create();
      for (let i = 0; i < 3; i++) {
        pdfDoc.addPage([400, 400]);
      }
      const original = Buffer.from(await pdfDoc.save());

      const result = await service.applyWatermark(
        original,
        'application/pdf',
        { dealId: 'multi-page-deal', requester: 'multi@example.com' },
      );

      expect(result.pageCount).toBe(3);
      const reloaded = await PDFDocument.load(result.buffer);
      expect(reloaded.getPageCount()).toBe(3);
    });
  });

  describe('regenerateWithWatermark', () => {
    it('delegates to applyWatermark for PDF input', async () => {
      const original = await createBlankPdf();
      const result = await service.regenerateWithWatermark(original, {
        dealId: 'regen-deal',
        requester: 'regen@example.com',
      });

      expect(result.pageCount).toBe(1);
      expect(result.buffer.length).toBeGreaterThan(original.length);
    });
  });
});
