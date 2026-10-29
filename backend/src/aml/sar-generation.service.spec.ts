import { createHash } from 'crypto';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import {
  SarGenerationService,
  defaultAuthority,
} from './sar-generation.service';
import type { AmlCase } from './entities/aml-case.entity';
import type { AmlAlert } from './entities/aml-alert.entity';
import type { User } from '../auth/entities/user.entity';

const CANONICAL_KEYS = [
  'sarNumber',
  'jurisdiction',
  'authority',
  'filingType',
  'subjects',
  'activities',
  'suspiciousAmountUsd',
  'activityFrom',
  'activityTo',
  'narrative',
].sort();

function canonicalHash(report: Record<string, any>): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        {
          ...report,
          activityFrom: report.activityFrom?.toISOString?.() ?? null,
          activityTo: report.activityTo?.toISOString?.() ?? null,
        },
        CANONICAL_KEYS,
      ),
    )
    .digest('hex');
}

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
    'setParameter',
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

function makeRepo(): any {
  const repo: any = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    save: jest.fn(async (entity: any) => entity),
    create: jest.fn((dto: any) => ({ id: 'sar-1', ...dto })),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    count: jest.fn().mockResolvedValue(0),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  repo.createQueryBuilder = jest.fn(() => makeQb());
  return repo;
}

function makeCase(overrides: Partial<AmlCase> = {}): AmlCase {
  return {
    id: 'case-1',
    caseNumber: 'AML-CASE-2026-000001',
    subjectUserId: 'user-1',
    alertIds: ['a1', 'a2'],
    priority: 'HIGH',
    riskScore: 88.5,
    status: 'open',
    ...overrides,
  } as AmlCase;
}

function makeAlert(overrides: Partial<AmlAlert> = {}): AmlAlert {
  return {
    id: 'a1',
    patternType: 'STRUCTURING',
    ruleCode: 'AML-MON-STRUCT-001',
    dealId: 'deal-1',
    riskScore: 72,
    amountUsd: 9000,
    title: 'Sub-threshold deposit clustering',
    matchReason: 'Three deposits below reporting threshold within 48h.',
    createdAt: new Date('2026-03-01T10:00:00.000Z'),
    ...overrides,
  } as AmlAlert;
}

function makeSubject(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    fullName: 'Alice Example',
    country: 'US',
    kycStatus: 'verified',
    walletAddress: '0xabc123',
    birthdate: '1980-01-01',
    role: 'farmer',
    ...overrides,
  } as User;
}

describe('SarGenerationService', () => {
  let sarRepo: any;
  let caseRepo: any;
  let alertRepo: any;
  let userRepo: any;
  let auditService: any;
  let service: SarGenerationService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    sarRepo = makeRepo();
    caseRepo = makeRepo();
    alertRepo = makeRepo();
    userRepo = makeRepo();
    auditService = { logEvent: jest.fn().mockResolvedValue(null) };
    service = new SarGenerationService(
      sarRepo,
      caseRepo,
      alertRepo,
      userRepo,
      auditService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  // ---------------------------------------------------------------- SAR number

  describe('nextSarNumber', () => {
    it('formats SAR-<year>-000001 from a zero count', async () => {
      sarRepo.createQueryBuilder.mockReturnValue(makeQb({ getCount: 0 }));
      const year = new Date().getUTCFullYear();
      await expect((service as any).nextSarNumber()).resolves.toBe(
        `SAR-${year}-000001`,
      );
    });

    it('pads the sequence deterministically from the persisted count', async () => {
      sarRepo.createQueryBuilder.mockReturnValue(makeQb({ getCount: 41 }));
      const year = new Date().getUTCFullYear();
      await expect((service as any).nextSarNumber()).resolves.toBe(
        `SAR-${year}-000042`,
      );
    });
  });

  // ------------------------------------------------------------------ generate

  describe('generate', () => {
    beforeEach(() => {
      caseRepo.findOne.mockResolvedValue(makeCase());
      userRepo.findOne.mockResolvedValue(makeSubject());
      alertRepo.find.mockResolvedValue([
        makeAlert({
          id: 'a1',
          amountUsd: 9000,
          createdAt: new Date('2026-03-01T10:00:00.000Z'),
        }),
        makeAlert({
          id: 'a2',
          amountUsd: 6000,
          title: 'Rapid movement of funds',
          patternType: 'RAPID_MOVEMENT',
          ruleCode: 'AML-MON-RAPID-001',
          matchReason: 'Funds withdrawn within 24h of receipt.',
          createdAt: new Date('2026-03-05T09:30:00.000Z'),
        }),
      ]);
    });

    it('throws BadRequestException when the case has no alerts', async () => {
      caseRepo.findOne.mockResolvedValue(makeCase({ alertIds: [] }));
      await expect(service.generate({ caseId: 'case-1' })).rejects.toThrow(
        BadRequestException,
      );
      expect(sarRepo.save).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the case is missing', async () => {
      caseRepo.findOne.mockResolvedValue(null);
      await expect(service.generate({ caseId: 'nope' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('persists a draft SAR whose narrative is assembled from evidence', async () => {
      const saved = await service.generate({ caseId: 'case-1' }, 'actor-1');

      expect(saved.status).toBe('draft');
      expect(saved.sarNumber).toBe(`SAR-${new Date().getUTCFullYear()}-000001`);
      expect(saved.generatedBy).toBe('actor-1');

      const narrative: string = saved.narrative;
      expect(narrative).toContain('Alice Example');
      expect(narrative).toContain('2026-03-01T10:00:00.000Z');
      expect(narrative).toContain('2026-03-05T09:30:00.000Z');
      expect(narrative).toContain('USD 15000.00');
      expect(narrative).toContain('1. 2026-03-01T10:00:00.000Z');
      expect(narrative).toContain('2. 2026-03-05T09:30:00.000Z');
      expect(narrative).toContain('Sub-threshold deposit clustering');
      expect(narrative).toContain('Rapid movement of funds');
      expect(narrative).toContain('tipping-off restrictions');
      expect(narrative).toContain('AML-CASE-2026-000001');

      expect(auditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ route: 'POST /admin/aml/sar' }),
      );
    });

    it('stores a sha256Hash equal to a recomputation over the canonical payload', async () => {
      const saved = await service.generate({ caseId: 'case-1' });
      expect(saved.sha256Hash).toBe(canonicalHash(saved));
      expect(saved.sha256Hash).toHaveLength(64);
    });

    it('produces a stable hash when regenerated from identical inputs', async () => {
      const first = await service.generate({ caseId: 'case-1' });
      const second = await service.generate({ caseId: 'case-1' });
      expect(first.sha256Hash).toBe(second.sha256Hash);
    });

    it('changes the hash when an alert amount changes', async () => {
      const before = await service.generate({ caseId: 'case-1' });
      alertRepo.find.mockResolvedValue([
        makeAlert({
          id: 'a1',
          amountUsd: 9000,
          createdAt: new Date('2026-03-01T10:00:00.000Z'),
        }),
        makeAlert({
          id: 'a2',
          amountUsd: 6500,
          createdAt: new Date('2026-03-05T09:30:00.000Z'),
        }),
      ]);
      const after = await service.generate({ caseId: 'case-1' });
      expect(after.sha256Hash).not.toBe(before.sha256Hash);
    });
  });

  // ------------------------------------------------------- defaultAuthority

  describe('defaultAuthority', () => {
    it('maps known jurisdictions and uppercases input', () => {
      expect(defaultAuthority('US')).toBe('FinCEN');
      expect(defaultAuthority('GB')).toBe('NCA');
      expect(defaultAuthority('uk')).toBe('NCA');
      expect(defaultAuthority('ng')).toBe('NFIU');
    });

    it('falls back to a generic national FIU for unknown jurisdictions', () => {
      expect(defaultAuthority('ZZ')).toBe('national FIU');
    });
  });

  // -------------------------------------------------------------- markReviewed

  describe('markReviewed', () => {
    it('moves a draft to reviewed with reviewer metadata', async () => {
      sarRepo.findOne.mockResolvedValue({
        id: 'sar-1',
        status: 'draft',
        reviewedBy: null,
        reviewedAt: null,
      });
      const result = await service.markReviewed('sar-1', 'actor-9');
      expect(result.status).toBe('reviewed');
      expect(result.reviewedBy).toBe('actor-9');
      expect(result.reviewedAt).toBeInstanceOf(Date);
      expect(sarRepo.save).toHaveBeenCalled();
    });

    it('rejects a report that is no longer a draft', async () => {
      sarRepo.findOne.mockResolvedValue({ id: 'sar-1', status: 'submitted' });
      await expect(service.markReviewed('sar-1', 'actor-9')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ------------------------------------------------------------- getSar/listSars

  describe('getSar', () => {
    it('returns the report when found', async () => {
      sarRepo.findOne.mockResolvedValue({ id: 'sar-1', status: 'draft' });
      await expect(service.getSar('sar-1')).resolves.toMatchObject({
        id: 'sar-1',
      });
    });

    it('throws NotFoundException when missing', async () => {
      sarRepo.findOne.mockResolvedValue(null);
      await expect(service.getSar('ghost')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listSars', () => {
    it('filters by status and clamps the limit', async () => {
      sarRepo.find.mockResolvedValue([{ id: 'sar-1' }]);
      const result = await service.listSars('draft', 500);
      expect(sarRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'draft' },
          take: 200,
        }),
      );
      expect(result).toHaveLength(1);
    });

    it('defaults to an empty filter and a minimum limit of 1', async () => {
      await service.listSars(undefined, 0);
      expect(sarRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, take: 1 }),
      );
    });
  });

  // ----------------------------------------------------------- verifyIntegrity

  describe('verifyIntegrity', () => {
    it('returns valid true for an untouched report', async () => {
      const saved = {
        sarNumber: 'SAR-2026-000001',
        jurisdiction: 'US',
        authority: 'FinCEN',
        filingType: 'initial',
        subjects: [{ userId: 'user-1' }],
        activities: [{ alertId: 'a1' }],
        suspiciousAmountUsd: 15000,
        activityFrom: new Date('2026-03-01T10:00:00.000Z'),
        activityTo: new Date('2026-03-05T09:30:00.000Z'),
        narrative: 'line one\nline two',
      };
      (saved as any).sha256Hash = canonicalHash(saved);
      sarRepo.findOne.mockResolvedValue(saved);
      await expect(service.verifyIntegrity('sar-1')).resolves.toEqual({
        valid: true,
        sha256Hash: (saved as any).sha256Hash,
      });
    });

    it('returns valid false when the stored hash no longer matches', async () => {
      sarRepo.findOne.mockResolvedValue({
        sarNumber: 'SAR-2026-000001',
        jurisdiction: 'US',
        authority: 'FinCEN',
        filingType: 'initial',
        subjects: [],
        activities: [],
        suspiciousAmountUsd: 15000,
        activityFrom: null,
        activityTo: null,
        narrative: 'tampered',
        sha256Hash: 'a'.repeat(64),
      });
      const result = await service.verifyIntegrity('sar-1');
      expect(result.valid).toBe(false);
      expect(result.sha256Hash).toBe('a'.repeat(64));
    });
  });

  // ------------------------------------------------------------------- analytics

  describe('analytics', () => {
    it('totals counts and amounts across statuses', async () => {
      sarRepo.createQueryBuilder.mockReturnValue(
        makeQb({
          getRawMany: [
            { status: 'draft', count: '2', amount: '1000.5' },
            { status: 'submitted', count: '1', amount: '500' },
          ],
        }),
      );
      const result = await service.analytics();
      expect(result).toEqual({
        total: 3,
        draft: 2,
        reviewed: 0,
        submitted: 1,
        acknowledged: 0,
        amountUsd: 1500.5,
      });
    });

    it('returns zeroed counters when there are no rows', async () => {
      sarRepo.createQueryBuilder.mockReturnValue(makeQb({ getRawMany: [] }));
      await expect(service.analytics()).resolves.toEqual({
        total: 0,
        draft: 0,
        reviewed: 0,
        submitted: 0,
        acknowledged: 0,
        amountUsd: 0,
      });
    });
  });
});
