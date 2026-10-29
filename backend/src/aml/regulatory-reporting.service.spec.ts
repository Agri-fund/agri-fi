import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import {
  RegulatoryReportingService,
  sanitizeResponse,
} from './regulatory-reporting.service';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeQb(handlers: Record<string, unknown> = {}) {
  const qb: Record<string, jest.Mock> = {};
  for (const m of [
    'where',
    'andWhere',
    'select',
    'addSelect',
    'groupBy',
    'orderBy',
    'limit',
    'skip',
  ]) {
    qb[m] = jest.fn().mockReturnThis();
  }
  qb.getCount = jest.fn().mockResolvedValue((handlers.getCount as number) ?? 0);
  qb.getOne = jest.fn().mockResolvedValue(handlers.getOne ?? null);
  qb.getMany = jest.fn().mockResolvedValue(handlers.getMany ?? []);
  qb.getRawMany = jest.fn().mockResolvedValue(handlers.getRawMany ?? []);
  qb.execute = jest.fn().mockResolvedValue(undefined);
  return qb;
}

function makeRepo(entityId: string): any {
  const repo: any = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    save: jest.fn(async (entity: any) => entity),
    create: jest.fn((dto: any) => ({ id: entityId, ...dto })),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    count: jest.fn().mockResolvedValue(0),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  repo.createQueryBuilder = jest.fn(() => makeQb());
  return repo;
}

function reviewedReport(): any {
  return {
    id: 'sar-1',
    sarNumber: 'SAR-2026-000001',
    jurisdiction: 'US',
    authority: 'FinCEN',
    filingType: 'initial',
    subjects: [{ userId: 'user-1' }],
    activities: [{ alertId: 'a1' }],
    suspiciousAmountUsd: 15000,
    activityFrom: new Date('2026-03-01T10:00:00.000Z'),
    activityTo: new Date('2026-03-05T09:30:00.000Z'),
    narrative: 'line one',
    sha256Hash: 'b'.repeat(64),
    status: 'reviewed',
    createdAt: new Date('2026-03-06T00:00:00.000Z'),
  };
}

const configuredDefaults: Record<string, string> = {
  AML_REGULATORY_REPORTING_ENABLED: 'true',
  AML_REGULATORY_REPORTING_URL: 'https://fiu.example.gov/submit',
  AML_REGULATORY_REPORTING_API_KEY: 'secret-api-key',
  AML_REGULATORY_REPORTING_TIMEOUT_MS: '15000',
};

describe('RegulatoryReportingService', () => {
  let submissionRepo: any;
  let sarRepo: any;
  let config: any;
  let auditService: any;
  let service: RegulatoryReportingService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    submissionRepo = makeRepo('sub-1');
    sarRepo = makeRepo('sar-1');
    config = { get: jest.fn((_key: string, def?: string) => def) };
    auditService = { logEvent: jest.fn().mockResolvedValue(null) };
    service = new RegulatoryReportingService(
      submissionRepo,
      sarRepo,
      config,
      auditService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  function configureApiChannel(): void {
    config.get = jest.fn((key: string, def?: string) =>
      key in configuredDefaults ? configuredDefaults[key] : def,
    );
    service = new RegulatoryReportingService(
      submissionRepo,
      sarRepo,
      config,
      auditService,
    );
  }

  // ------------------------------------------------------------------ precheck

  describe('submit preconditions', () => {
    it('throws NotFoundException for an unknown report', async () => {
      sarRepo.findOne.mockResolvedValue(null);
      await expect(service.submit({ sarReportId: 'ghost' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects a draft report before it has been reviewed', async () => {
      sarRepo.findOne.mockResolvedValue({
        ...reviewedReport(),
        status: 'draft',
      });
      await expect(
        service.submit({ sarReportId: 'sar-1' }),
      ).rejects.toMatchObject({
        message:
          'A report must be reviewed by an officer before it can be filed',
      });
      await expect(service.submit({ sarReportId: 'sar-1' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a report that was already submitted', async () => {
      sarRepo.findOne.mockResolvedValue({
        ...reviewedReport(),
        status: 'submitted',
      });
      await expect(service.submit({ sarReportId: 'sar-1' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a report that was already acknowledged', async () => {
      sarRepo.findOne.mockResolvedValue({
        ...reviewedReport(),
        status: 'acknowledged',
      });
      await expect(service.submit({ sarReportId: 'sar-1' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ------------------------------------------------------------- manual channel

  describe('submit via manual secure portal (API not configured)', () => {
    it('persists a pending manual submission and never calls axios', async () => {
      sarRepo.findOne.mockResolvedValue(reviewedReport());

      const result = await service.submit({ sarReportId: 'sar-1' }, 'actor-1');

      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(result.channel).toBe('manual_secure_portal');
      expect(result.status).toBe('pending');
      expect(result.authorityReference).toBeNull();
      expect(result.submissionId).toBe('sub-1');
      expect(result.submissionNumber).toBe(
        `SUB-${new Date().getUTCFullYear()}-000001`,
      );
      expect(result.message.toLowerCase()).toContain('portal');

      const created = submissionRepo.create.mock.calls[0][0];
      expect(created.channel).toBe('manual_secure_portal');
      expect(created.status).toBe('pending');
      expect(created.attempt).toBe(1);
      expect(created.requestSummary.transportConfigured).toBe(false);
      expect(created.submittedBy).toBe('actor-1');
      expect(submissionRepo.save).toHaveBeenCalled();
      expect(auditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 202 }),
      );
    });

    it('records an explicit manual filing with its own message', async () => {
      configureApiChannel();
      sarRepo.findOne.mockResolvedValue(reviewedReport());

      const result = await service.submit({
        sarReportId: 'sar-1',
        manualFiling: true,
      });

      expect(result.channel).toBe('manual_secure_portal');
      expect(result.message).toBe(
        'Recorded as a manual filing on the authority portal.',
      );
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------- api channel

  describe('submit via configured API channel', () => {
    beforeEach(() => configureApiChannel());

    it('marks the submission accepted and flips the SAR to submitted on 201', async () => {
      sarRepo.findOne.mockResolvedValue(reviewedReport());
      mockedAxios.post.mockResolvedValue({
        status: 201,
        data: { reference: 'REF-99', noise: 'ignored' },
      } as any);

      const result = await service.submit({ sarReportId: 'sar-1' }, 'actor-2');

      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('accepted');
      expect(result.channel).toBe('api');
      expect(result.authorityReference).toBe('REF-99');
      expect(result.message).toBe('Report filed with the authority.');

      const firstSave = submissionRepo.save.mock.calls[0][0];
      expect(firstSave.status).toBe('pending');
      const lastSave =
        submissionRepo.save.mock.calls[
          submissionRepo.save.mock.calls.length - 1
        ][0];
      expect(lastSave.status).toBe('accepted');
      expect(lastSave.authorityReference).toBe('REF-99');
      expect(lastSave.submittedAt).toBeInstanceOf(Date);
      expect(sarRepo.update).toHaveBeenCalledWith(
        { id: 'sar-1' },
        expect.objectContaining({ status: 'submitted' }),
      );
    });

    it('marks the submission rejected on a 4xx response', async () => {
      sarRepo.findOne.mockResolvedValue(reviewedReport());
      mockedAxios.post.mockRejectedValue({
        message: 'Bad payload',
        response: { status: 422, data: { message: 'validation failed' } },
      });

      const result = await service.submit({ sarReportId: 'sar-1' });

      expect(result.status).toBe('rejected');
      expect(result.message).toBe(
        'The authority rejected the filing; correct and re-file.',
      );
      expect(sarRepo.update).not.toHaveBeenCalled();
      const lastSave =
        submissionRepo.save.mock.calls[
          submissionRepo.save.mock.calls.length - 1
        ][0];
      expect(lastSave.status).toBe('rejected');
    });

    it('marks the submission failed on a 5xx response and keeps the row', async () => {
      sarRepo.findOne.mockResolvedValue(reviewedReport());
      mockedAxios.post.mockRejectedValue({
        message: 'Upstream error',
        response: { status: 503, data: { detail: 'down' } },
      });

      const result = await service.submit({ sarReportId: 'sar-1' });

      expect(result.status).toBe('failed');
      expect(submissionRepo.save).toHaveBeenCalled();
      expect(submissionRepo.save.mock.calls[0][0].status).toBe('pending');
      expect(sarRepo.update).not.toHaveBeenCalled();
    });

    it('marks the submission failed on a network error with no response', async () => {
      sarRepo.findOne.mockResolvedValue(reviewedReport());
      mockedAxios.post.mockRejectedValue({ message: 'ECONNREFUSED' });

      const result = await service.submit({ sarReportId: 'sar-1' });

      expect(result.status).toBe('failed');
      expect(result.message).toBe(
        'Filing could not be completed; the submission is queued for retry.',
      );
    });

    it('writes the pending row before attempting the transport', async () => {
      sarRepo.findOne.mockResolvedValue(reviewedReport());
      const order: string[] = [];
      submissionRepo.save.mockImplementation(async (entity: any) => {
        order.push(`save:${entity.status}`);
        return entity;
      });
      mockedAxios.post.mockImplementation(async () => {
        order.push('axios');
        throw { message: 'boom' };
      });

      await service.submit({ sarReportId: 'sar-1' });

      expect(order.slice(0, 2)).toEqual(['save:pending', 'axios']);
    });
  });

  // --------------------------------------------------------------------- retry

  describe('retry', () => {
    it('rejects an already accepted submission', async () => {
      submissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        status: 'accepted',
      });
      await expect(service.retry('sub-1')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for an unknown submission', async () => {
      submissionRepo.findOne.mockResolvedValue(null);
      await expect(service.retry('ghost')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the backing report is missing', async () => {
      submissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        status: 'failed',
        reportId: 'sar-1',
        attempt: 1,
      });
      sarRepo.findOne.mockResolvedValue(null);
      await expect(service.retry('sub-1')).rejects.toThrow(NotFoundException);
    });

    it('bumps the attempt counter and re-files', async () => {
      submissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        status: 'failed',
        reportId: 'sar-1',
        attempt: 3,
      });
      sarRepo.findOne.mockResolvedValue(reviewedReport());
      const submitSpy = jest
        .spyOn(service, 'submit')
        .mockResolvedValue({ message: 'ok' } as any);

      await service.retry('sub-1', 'actor-3');

      expect(submissionRepo.update).toHaveBeenCalledWith(
        { id: 'sub-1' },
        { status: 'failed', attempt: 4 },
      );
      expect(submitSpy).toHaveBeenCalledWith(
        { sarReportId: 'sar-1' },
        'actor-3',
      );
    });

    it('re-opens a submitted SAR back to reviewed when re-filing', async () => {
      submissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        status: 'failed',
        reportId: 'sar-1',
        attempt: 1,
      });
      sarRepo.findOne.mockResolvedValue({
        ...reviewedReport(),
        status: 'submitted',
      });
      jest.spyOn(service, 'submit').mockResolvedValue({ message: 'ok' } as any);

      await service.retry('sub-1');

      expect(sarRepo.update).toHaveBeenCalledWith(
        { id: 'sar-1' },
        { status: 'reviewed', filedAt: null },
      );
    });
  });

  // ---------------------------------------------------------- markAcknowledged

  describe('markAcknowledged', () => {
    it('accepts the submission and acknowledges the SAR', async () => {
      submissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        submissionNumber: 'SUB-2026-000001',
        reportId: 'sar-1',
        status: 'pending',
        authorityReference: null,
        submittedAt: null,
      });

      const saved = await service.markAcknowledged(
        'sub-1',
        'AUTH-REF',
        'actor-4',
      );

      expect(saved.status).toBe('accepted');
      expect(saved.authorityReference).toBe('AUTH-REF');
      expect(saved.submittedAt).toBeInstanceOf(Date);
      expect(sarRepo.update).toHaveBeenCalledWith(
        { id: 'sar-1' },
        expect.objectContaining({ status: 'acknowledged' }),
      );
      expect(auditService.logEvent).toHaveBeenCalled();
    });

    it('keeps the existing reference when none is supplied', async () => {
      submissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        submissionNumber: 'SUB-2026-000001',
        reportId: 'sar-1',
        status: 'pending',
        authorityReference: 'PRIOR',
        submittedAt: new Date('2026-03-01T00:00:00.000Z'),
      });

      const saved = await service.markAcknowledged('sub-1', null);

      expect(saved.authorityReference).toBe('PRIOR');
    });

    it('throws NotFoundException for an unknown submission', async () => {
      submissionRepo.findOne.mockResolvedValue(null);
      await expect(service.markAcknowledged('ghost', 'REF')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ------------------------------------------------------- list / dueForRetry

  describe('listSubmissions', () => {
    it('filters and clamps the page size', async () => {
      submissionRepo.findAndCount.mockResolvedValue([[{ id: 'sub-1' }], 7]);
      const result = await service.listSubmissions('failed', 999);
      expect(result).toEqual({ items: [{ id: 'sub-1' }], total: 7 });
      expect(submissionRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'failed' }, take: 200 }),
      );
    });

    it('uses an empty filter when no status is given', async () => {
      await service.listSubmissions(undefined, 5);
      expect(submissionRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, take: 5 }),
      );
    });
  });

  describe('dueForRetry', () => {
    it('returns pending and failed submissions', async () => {
      submissionRepo.find.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      const result = await service.dueForRetry(10);
      expect(result).toHaveLength(2);
      expect(submissionRepo.find).toHaveBeenCalledWith({
        where: [{ status: 'pending' }, { status: 'failed' }],
        order: { createdAt: 'ASC' },
        take: 10,
      });
    });
  });

  // ------------------------------------------------------------ reportingMetrics

  describe('reportingMetrics', () => {
    it('computes acceptance rate and outstanding backlog', async () => {
      submissionRepo.createQueryBuilder.mockReturnValue(
        makeQb({
          getRawMany: [
            { status: 'accepted', count: '3' },
            { status: 'pending', count: '1' },
            { status: 'failed', count: '1' },
          ],
        }),
      );
      const metrics = await service.reportingMetrics();
      expect(metrics.byStatus).toEqual({ accepted: 3, pending: 1, failed: 1 });
      expect(metrics.acceptanceRate).toBeCloseTo(0.6, 5);
      expect(metrics.outstanding).toBe(2);
    });

    it('guards against divide-by-zero when there are no submissions', async () => {
      submissionRepo.createQueryBuilder.mockReturnValue(
        makeQb({ getRawMany: [] }),
      );
      const metrics = await service.reportingMetrics();
      expect(metrics.byStatus).toEqual({});
      expect(metrics.acceptanceRate).toBe(0);
      expect(metrics.outstanding).toBe(0);
    });
  });

  // ------------------------------------------------------------ sanitizeResponse

  describe('sanitizeResponse', () => {
    it('keeps only whitelisted keys from a large object', () => {
      const out = sanitizeResponse({
        reference: 'REF-1',
        status: 'ok',
        message: 'accepted',
        secret: 'super-sensitive',
        token: 'abc',
        blob: 'x'.repeat(10000),
      });
      expect(out).toEqual({
        reference: 'REF-1',
        status: 'ok',
        message: 'accepted',
      });
      expect(out).not.toHaveProperty('secret');
      expect(out).not.toHaveProperty('blob');
    });

    it('redacts an empty object to only allowed keys present', () => {
      expect(sanitizeResponse({ unexpected: 1 })).toEqual({});
    });

    it('wraps a non-object into a detail string', () => {
      expect(sanitizeResponse(42)).toEqual({ detail: '42' });
      expect(sanitizeResponse('boom')).toEqual({ detail: 'boom' });
    });

    it('renders an empty detail for null and undefined', () => {
      expect(sanitizeResponse(null)).toEqual({ detail: '' });
      expect(sanitizeResponse(undefined)).toEqual({ detail: '' });
    });
  });
});
