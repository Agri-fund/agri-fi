import { inflateSync } from 'zlib';
import { NotFoundException } from '@nestjs/common';
import {
  DEFAULT_TAX_STATEMENT_ASYNC_THRESHOLD,
  TAX_STATEMENT_GENERATE,
  TaxReportService,
} from './tax-report.service';
import { InvestmentStatus } from './entities/investment.entity';

const mockS3Send = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  PutObjectCommand: jest
    .fn()
    .mockImplementation((input) => ({ __cmd: 'put', input })),
  GetObjectCommand: jest
    .fn()
    .mockImplementation((input) => ({ __cmd: 'get', input })),
}));
const mockGetSignedUrl = jest
  .fn()
  .mockResolvedValue('https://s3.example/signed-url');
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

/** Pull the visible text out of a PDFKit document (inflates each stream and decodes hex TJ/Tj strings). */
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const out: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch {
      content = m[1];
    }
    // Each `[<hex> kern <hex> …] TJ` is one visual text run; PDFKit splits it
    // at kerning pairs, so join the pieces of a run without a separator.
    const tj = /\[([^\]]*)\]\s*TJ/g;
    let t: RegExpExecArray | null;
    while ((t = tj.exec(content))) {
      const pieces = [...t[1].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) =>
        Buffer.from(x[1], 'hex').toString('latin1'),
      );
      out.push(pieces.join(''));
    }
    const lit = /<([0-9a-fA-F]+)>\s*Tj/g;
    let l: RegExpExecArray | null;
    while ((l = lit.exec(content))) {
      out.push(Buffer.from(l[1], 'hex').toString('latin1'));
    }
  }
  return out.join(' ');
}

function makeInvestment(over: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    tradeDealId: 'deal-aaaa-1111',
    tradeDeal: { title: 'Cocoa Export Q1' },
    tokenAmount: 150,
    amountUsd: '1000.00',
    returnAmountUsd: '1200.00',
    feesUsd: '10.00',
    status: InvestmentStatus.CONFIRMED,
    createdAt: new Date('2024-03-10T12:00:00Z'),
    ...over,
  };
}

describe('TaxReportService — PDF tax statement (#1298)', () => {
  let investments: ReturnType<typeof makeInvestment>[];
  let count: number;
  let qb: Record<string, jest.Mock>;
  const investmentRepo = { createQueryBuilder: jest.fn() };
  const userRepo = { findOne: jest.fn() };
  const queueService = { emit: jest.fn().mockResolvedValue(undefined) };
  const notifications = { sendEmail: jest.fn().mockResolvedValue(undefined) };
  const configValues: Record<string, unknown> = { AWS_S3_BUCKET: 'bkt' };
  const config = {
    get: jest.fn((key: string, def?: unknown) =>
      key in configValues ? configValues[key] : def,
    ),
  };
  let service: TaxReportService;

  beforeEach(() => {
    jest.clearAllMocks();
    investments = [makeInvestment()];
    count = investments.length;
    qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockImplementation(async () => investments),
      getCount: jest.fn().mockImplementation(async () => count),
    };
    investmentRepo.createQueryBuilder.mockReturnValue(qb);
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      email: 'jane@example.com',
      companyDetails: null,
    });
    delete configValues.TAX_STATEMENT_ASYNC_THRESHOLD;
    service = new TaxReportService(
      investmentRepo as any,
      userRepo as any,
      queueService as any,
      notifications as any,
      config as any,
    );
  });

  describe('buildStatementData', () => {
    it('returns investor, deal IDs, token quantities, USD amounts and the income breakdown', async () => {
      investments = [
        makeInvestment(),
        makeInvestment({
          id: 'inv-2',
          tradeDealId: 'deal-bbbb-2222',
          tokenAmount: 50,
          amountUsd: '500.00',
          returnAmountUsd: '400.00',
          feesUsd: '0',
        }),
      ];

      const data = await service.buildStatementData('user-1', 2024);

      expect(data.year).toBe(2024);
      expect(data.investorName).toBe('jane@example.com');
      expect(data.rows.map((r) => r.dealId)).toEqual([
        'deal-aaaa-1111',
        'deal-bbbb-2222',
      ]);
      expect(data.rows[0]).toMatchObject({
        tokenQuantity: 150,
        investedUsd: 1000,
        returnedUsd: 1200,
        feesUsd: 10,
        netUsd: 190,
        category: 'income',
      });
      expect(data.rows[1]).toMatchObject({
        netUsd: -100,
        category: 'capital_loss',
      });
      expect(data.totals).toEqual({
        tokenQuantity: 200,
        investedUsd: 1500,
        returnedUsd: 1600,
        feesUsd: 10,
        incomeUsd: 190,
        capitalLossUsd: 100,
        netUsd: 90,
      });
    });

    it('filters to confirmed investments inside the requested tax year', async () => {
      await service.buildStatementData('user-1', 2024);
      expect(qb.andWhere).toHaveBeenCalledWith('inv.status = :status', {
        status: InvestmentStatus.CONFIRMED,
      });
      expect(qb.andWhere).toHaveBeenCalledWith('inv.createdAt >= :start', {
        start: new Date('2024-01-01T00:00:00Z'),
      });
      expect(qb.andWhere).toHaveBeenCalledWith('inv.createdAt < :end', {
        end: new Date('2025-01-01T00:00:00Z'),
      });
    });

    it('prefers the company name for company investors', async () => {
      userRepo.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'c@example.com',
        companyDetails: { companyName: 'Agri Corp Ltd' },
      });
      const data = await service.buildStatementData('user-1', 2024);
      expect(data.investorName).toBe('Agri Corp Ltd');
    });

    it('throws NotFoundException for an unknown investor', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.buildStatementData('nope', 2024)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('renderStatementPdf', () => {
    it('produces a real PDF containing every required field', async () => {
      const data = await service.buildStatementData('user-1', 2024);
      const pdf = await service.renderStatementPdf(data);

      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.subarray(-6).toString()).toContain('%%EOF');

      const text = pdfText(pdf);
      expect(text).toContain('Tax Statement');
      expect(text).toContain('Tax year: 2024');
      expect(text).toContain('jane@example.com'); // investor name
      expect(text).toContain('deal-aaaa-1111'); // deal ID
      expect(text).toContain('150'); // token quantity
      expect(text).toContain('$1,000.00'); // invested USD
      expect(text).toContain('$1,200.00'); // returned USD
      expect(text).toContain('Income (realised gain on deals): $190.00');
      expect(text).toContain('Capital loss');
      expect(text).toContain('does not constitute professional tax advice');
    });

    it('renders an empty-portfolio statement', async () => {
      investments = [];
      const data = await service.buildStatementData('user-1', 2023);
      const text = pdfText(await service.renderStatementPdf(data));
      expect(text).toContain('Tax year: 2023');
      expect(text).toContain('No confirmed investments in this tax year.');
    });

    it('paginates large portfolios', async () => {
      investments = Array.from({ length: 120 }, (_, i) =>
        makeInvestment({ id: `inv-${i}`, tradeDealId: `deal-${i}` }),
      );
      const data = await service.buildStatementData('user-1', 2024);
      const pdf = await service.renderStatementPdf(data);
      const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? [])
        .length;
      expect(pages).toBeGreaterThan(1);
      expect(pdfText(pdf)).toContain('deal-119');
    });
  });

  describe('requestStatement', () => {
    it('generates the PDF inline for a normal portfolio', async () => {
      const result = await service.requestStatement('user-1', 2024);
      expect(result.queued).toBe(false);
      if (result.queued) throw new Error('unreachable');
      expect(result.filename).toBe('tax-statement-2024.pdf');
      expect(result.pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(queueService.emit).not.toHaveBeenCalled();
    });

    it('queues a background job for a large portfolio', async () => {
      count = DEFAULT_TAX_STATEMENT_ASYNC_THRESHOLD + 1;
      const result = await service.requestStatement('user-1', 2024);
      expect(result).toEqual({ queued: true, year: 2024 });
      expect(queueService.emit).toHaveBeenCalledWith(TAX_STATEMENT_GENERATE, {
        investorId: 'user-1',
        year: 2024,
      });
      expect(qb.getMany).not.toHaveBeenCalled();
    });

    it('honours TAX_STATEMENT_ASYNC_THRESHOLD', async () => {
      configValues.TAX_STATEMENT_ASYNC_THRESHOLD = 1;
      count = 2;
      const result = await service.requestStatement('user-1', 2024);
      expect(result.queued).toBe(true);
    });
  });

  describe('generateAndEmailStatement (background path)', () => {
    it('uploads the PDF to S3 and emails a download link', async () => {
      const { key, url } = await service.generateAndEmailStatement({
        investorId: 'user-1',
        year: 2024,
      });

      expect(key).toBe('tax-statements/user-1/tax-statement-2024.pdf');
      expect(url).toBe('https://s3.example/signed-url');

      const put = mockS3Send.mock.calls[0][0];
      expect(put.input).toMatchObject({
        Bucket: 'bkt',
        Key: key,
        ContentType: 'application/pdf',
      });
      expect((put.input.Body as Buffer).subarray(0, 5).toString()).toBe(
        '%PDF-',
      );

      expect(notifications.sendEmail).toHaveBeenCalledTimes(1);
      const [to, subject, text, html] = notifications.sendEmail.mock.calls[0];
      expect(to).toBe('jane@example.com');
      expect(subject).toContain('2024');
      expect(text).toContain(url);
      expect(html).toContain(url);
    });

    it('does not email when the upload fails', async () => {
      mockS3Send.mockRejectedValueOnce(new Error('S3 down'));
      await expect(
        service.generateAndEmailStatement({ investorId: 'user-1', year: 2024 }),
      ).rejects.toThrow('S3 down');
      expect(notifications.sendEmail).not.toHaveBeenCalled();
    });
  });
});
