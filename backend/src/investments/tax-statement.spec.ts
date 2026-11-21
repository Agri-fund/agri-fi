import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpStatus } from '@nestjs/common';
import { InvestmentsController } from './investments.controller';
import { InvestmentsService } from './investments.service';
import { StellarService } from '../stellar/stellar.service';
import { IdempotencyService } from '../queue/idempotency.service';
import { InvestmentEventStore } from './investment-event-store.service';
import { TaxReportService, TaxReportFormat } from './tax-report.service';
import { ReceiptService } from './receipt.service';
import { InvoiceService } from './invoice.service';
import { PortfolioSummaryService } from './portfolio-summary.service';
import { PortfolioVaRService } from './portfolio-var.service';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Investment } from './entities/investment.entity';
import { AuditService } from '../audit/audit.service';
import { TaxStatementConsumer } from './tax-statement.consumer';
import { encryptPayload } from '../queue/queue.crypto';

// The shared guards barrel re-exports a module that does not exist on
// upstream main (auth/guards/admin.guard), which stops any controller that
// imports it from loading under jest. Guards are irrelevant to these tests,
// so stub the barrel with pass-through guards.
// Likewise tracing/tracing.service.ts has a syntax error on upstream main.
jest.mock('../tracing/tracing.service', () => ({
  TracingService: class TracingService {},
}));

jest.mock('../common/guards', () => {
  class AllowGuard {
    canActivate() {
      return true;
    }
  }
  return { KycGuard: AllowGuard, RolesGuard: AllowGuard };
});

function mockRes() {
  const res: any = {
    setHeader: jest.fn(),
    send: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
  };
  return res;
}

describe('GET /investments/tax-statement (#1298)', () => {
  let controller: InvestmentsController;
  const taxReportService = {
    requestStatement: jest.fn(),
    buildReportData: jest.fn(),
    toCsv: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [InvestmentsController],
      providers: [
        { provide: InvestmentsService, useValue: {} },
        { provide: StellarService, useValue: {} },
        { provide: IdempotencyService, useValue: {} },
        { provide: InvestmentEventStore, useValue: {} },
        { provide: TaxReportService, useValue: taxReportService },
        { provide: AuditService, useValue: {} },
        { provide: ReceiptService, useValue: {} },
        { provide: InvoiceService, useValue: {} },
        { provide: PortfolioSummaryService, useValue: {} },
        { provide: PortfolioVaRService, useValue: {} },
        { provide: getRepositoryToken(TradeDeal), useValue: {} },
        { provide: getRepositoryToken(Investment), useValue: {} },
      ],
    }).compile();
    controller = module.get(InvestmentsController);
  });

  const req = { user: { id: 'user-1' } };

  it('streams the PDF with the correct Content-Type and Content-Disposition', async () => {
    const pdf = Buffer.from('%PDF-1.3 test');
    taxReportService.requestStatement.mockResolvedValue({
      queued: false,
      pdf,
      filename: 'tax-statement-2024.pdf',
    });
    const res = mockRes();

    await controller.taxStatement(req, { year: 2024 }, res);

    expect(taxReportService.requestStatement).toHaveBeenCalledWith(
      'user-1',
      2024,
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/pdf',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="tax-statement-2024.pdf"',
    );
    expect(res.send).toHaveBeenCalledWith(pdf);
  });

  it('defaults the year filter to the current year', async () => {
    taxReportService.requestStatement.mockResolvedValue({
      queued: false,
      pdf: Buffer.from('%PDF'),
      filename: 'x.pdf',
    });
    await controller.taxStatement(req, {}, mockRes());
    expect(taxReportService.requestStatement).toHaveBeenCalledWith(
      'user-1',
      new Date().getUTCFullYear(),
    );
  });

  it('answers 202 and does not send a PDF when generation is queued', async () => {
    taxReportService.requestStatement.mockResolvedValue({
      queued: true,
      year: 2024,
    });
    const res = mockRes();

    await controller.taxStatement(req, { year: 2024 }, res);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.ACCEPTED);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ year: 2024 }),
    );
    expect(res.send).not.toHaveBeenCalled();
  });

  it('tax-report?format=pdf now returns a real PDF instead of the JSON stub', async () => {
    const pdf = Buffer.from('%PDF-1.3 report');
    taxReportService.buildReportData.mockResolvedValue({ rows: [] });
    taxReportService.requestStatement.mockResolvedValue({
      queued: false,
      pdf,
      filename: 'tax-statement-2025.pdf',
    });
    const res = mockRes();

    await controller.taxReport(
      req,
      { year: 2025, format: TaxReportFormat.PDF },
      res,
    );

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/pdf',
    );
    expect(res.send).toHaveBeenCalledWith(pdf);
  });
});

describe('TaxStatementConsumer (#1298)', () => {
  const service = { generateAndEmailStatement: jest.fn() };
  const consumer = new TaxStatementConsumer(service as any);
  const channel = { ack: jest.fn(), nack: jest.fn() };
  const msg = { properties: { headers: {} } };
  const ctx = {
    getChannelRef: () => channel,
    getMessage: () => msg,
  } as any;

  beforeAll(() => {
    process.env.QUEUE_ENCRYPTION_KEY ??= 'a'.repeat(64);
  });
  beforeEach(() => jest.clearAllMocks());

  it('generates the statement and acks a plain payload', async () => {
    service.generateAndEmailStatement.mockResolvedValue({});
    await consumer.handleGenerate({ investorId: 'u1', year: 2024 }, ctx);
    expect(service.generateAndEmailStatement).toHaveBeenCalledWith({
      investorId: 'u1',
      year: 2024,
    });
    expect(channel.ack).toHaveBeenCalledWith(msg);
  });

  it('decrypts payloads produced by QueueService.emit', async () => {
    service.generateAndEmailStatement.mockResolvedValue({});
    const encrypted = encryptPayload(
      { investorId: 'u2', year: 2023 },
      'tax-statement.generate',
    );
    await consumer.handleGenerate(encrypted, ctx);
    expect(service.generateAndEmailStatement).toHaveBeenCalledWith({
      investorId: 'u2',
      year: 2023,
    });
    expect(channel.ack).toHaveBeenCalled();
  });

  it('dead-letters malformed messages without retrying', async () => {
    await consumer.handleGenerate({ nope: true }, ctx);
    expect(service.generateAndEmailStatement).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(msg, false, false);
  });

  it('requeues a failed job for retry', async () => {
    service.generateAndEmailStatement.mockRejectedValue(new Error('smtp'));
    await consumer.handleGenerate({ investorId: 'u1', year: 2024 }, ctx);
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(msg, false, true);
  });
});
