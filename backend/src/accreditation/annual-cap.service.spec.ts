import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnprocessableEntityException } from '@nestjs/common';
import { AnnualCapService } from './annual-cap.service';
import { AnnualInvestmentTotal } from './entities/annual-investment-total.entity';
import {
  tierSatisfies,
  ANNUAL_CAP_USD,
  PER_DEAL_CAP_USD,
  TIER_ORDER,
} from '../auth/entities/user.entity';
import type { AccreditationTier } from '../auth/entities/user.entity';

// ─── Tier helper unit tests ────────────────────────────────────────────────

describe('tierSatisfies', () => {
  it('retail satisfies retail', () => {
    expect(tierSatisfies('retail', 'retail')).toBe(true);
  });

  it('accredited satisfies retail', () => {
    expect(tierSatisfies('accredited', 'retail')).toBe(true);
  });

  it('accredited satisfies accredited', () => {
    expect(tierSatisfies('accredited', 'accredited')).toBe(true);
  });

  it('retail does NOT satisfy accredited', () => {
    expect(tierSatisfies('retail', 'accredited')).toBe(false);
  });

  it('retail does NOT satisfy institutional', () => {
    expect(tierSatisfies('retail', 'institutional')).toBe(false);
  });

  it('accredited does NOT satisfy institutional', () => {
    expect(tierSatisfies('accredited', 'institutional')).toBe(false);
  });

  it('institutional satisfies all tiers', () => {
    for (const tier of TIER_ORDER) {
      expect(tierSatisfies('institutional', tier)).toBe(true);
    }
  });
});

describe('ANNUAL_CAP_USD', () => {
  it('retail has a finite annual cap of 10,000', () => {
    expect(ANNUAL_CAP_USD.retail).toBe(10_000);
  });

  it('accredited has no annual cap', () => {
    expect(ANNUAL_CAP_USD.accredited).toBe(Infinity);
  });

  it('institutional has no annual cap', () => {
    expect(ANNUAL_CAP_USD.institutional).toBe(Infinity);
  });
});

describe('PER_DEAL_CAP_USD', () => {
  it('retail has a per-deal cap of 5,000', () => {
    expect(PER_DEAL_CAP_USD.retail).toBe(5_000);
  });

  it('accredited has a per-deal cap of 50,000', () => {
    expect(PER_DEAL_CAP_USD.accredited).toBe(50_000);
  });

  it('institutional has no per-deal cap', () => {
    expect(PER_DEAL_CAP_USD.institutional).toBe(Infinity);
  });
});

// ─── AnnualCapService unit tests ───────────────────────────────────────────

function makeAnnualTotal(
  investorId: string,
  year: number,
  totalUsd: number,
): AnnualInvestmentTotal {
  const record = new AnnualInvestmentTotal();
  record.id = `${investorId}-${year}`;
  record.investorId = investorId;
  record.year = year;
  record.totalUsd = totalUsd;
  record.updatedAt = new Date();
  return record;
}

describe('AnnualCapService', () => {
  let service: AnnualCapService;
  let mockRepo: jest.Mocked<{
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    query: jest.Mock;
  }>;

  const INVESTOR_ID = 'investor-uuid-123';
  const CURRENT_YEAR = new Date().getFullYear();

  beforeEach(async () => {
    mockRepo = {
      findOne: jest.fn(),
      create: jest.fn((data) => ({ ...data })),
      save: jest.fn(async (entity) => entity),
      query: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnualCapService,
        {
          provide: getRepositoryToken(AnnualInvestmentTotal),
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get<AnnualCapService>(AnnualCapService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── enforceCaps ──────────────────────────────────────────────────────────

  describe('enforceCaps — tier gating', () => {
    it('throws TIER_INSUFFICIENT when retail investor tries to access accredited deal', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.enforceCaps(INVESTOR_ID, 'retail', 100, 'accredited'),
      ).rejects.toMatchObject({
        response: { code: 'TIER_INSUFFICIENT' },
      });
    });

    it('throws TIER_INSUFFICIENT when retail investor tries to access institutional deal', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.enforceCaps(INVESTOR_ID, 'retail', 100, 'institutional'),
      ).rejects.toMatchObject({
        response: { code: 'TIER_INSUFFICIENT' },
      });
    });

    it('allows accredited investor to access accredited deal', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.enforceCaps(INVESTOR_ID, 'accredited', 1_000, 'accredited'),
      ).resolves.toBeUndefined();
    });

    it('allows institutional investor to access all deals', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      for (const dealTier of TIER_ORDER as AccreditationTier[]) {
        await expect(
          service.enforceCaps(INVESTOR_ID, 'institutional', 1_000, dealTier),
        ).resolves.toBeUndefined();
      }
    });
  });

  describe('enforceCaps — per-deal cap', () => {
    it('throws PER_DEAL_CAP_EXCEEDED when retail invests more than $5,000 on a single deal', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.enforceCaps(INVESTOR_ID, 'retail', 5_001, 'retail'),
      ).rejects.toMatchObject({
        response: { code: 'PER_DEAL_CAP_EXCEEDED' },
      });
    });

    it('allows retail investor to invest exactly $5,000 on a single deal', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.enforceCaps(INVESTOR_ID, 'retail', 5_000, 'retail'),
      ).resolves.toBeUndefined();
    });

    it('throws PER_DEAL_CAP_EXCEEDED when accredited invests more than $50,000 on a single deal', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.enforceCaps(INVESTOR_ID, 'accredited', 50_001, 'retail'),
      ).rejects.toMatchObject({
        response: { code: 'PER_DEAL_CAP_EXCEEDED' },
      });
    });

    it('institutional investor has no per-deal cap', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.enforceCaps(INVESTOR_ID, 'institutional', 1_000_000, 'retail'),
      ).resolves.toBeUndefined();
    });
  });

  describe('enforceCaps — annual cap', () => {
    it('throws ANNUAL_CAP_EXCEEDED when retail investor exceeds $10,000 annual cap', async () => {
      mockRepo.findOne.mockResolvedValue(
        makeAnnualTotal(INVESTOR_ID, CURRENT_YEAR, 8_000),
      );

      await expect(
        service.enforceCaps(INVESTOR_ID, 'retail', 3_000, 'retail'),
      ).rejects.toMatchObject({
        response: { code: 'ANNUAL_CAP_EXCEEDED' },
      });
    });

    it('allows retail investor to invest exactly up to $10,000 annual cap', async () => {
      mockRepo.findOne.mockResolvedValue(
        makeAnnualTotal(INVESTOR_ID, CURRENT_YEAR, 5_000),
      );

      await expect(
        service.enforceCaps(INVESTOR_ID, 'retail', 5_000, 'retail'),
      ).resolves.toBeUndefined();
    });

    it('allows retail investor when there is no prior annual record', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await expect(
        service.enforceCaps(INVESTOR_ID, 'retail', 4_000, 'retail'),
      ).resolves.toBeUndefined();
    });

    it('accredited investor is NOT subject to annual cap', async () => {
      // Annual total already at $500,000
      mockRepo.findOne.mockResolvedValue(
        makeAnnualTotal(INVESTOR_ID, CURRENT_YEAR, 500_000),
      );

      await expect(
        service.enforceCaps(INVESTOR_ID, 'accredited', 49_000, 'retail'),
      ).resolves.toBeUndefined();
    });

    it('institutional investor is NOT subject to annual cap', async () => {
      mockRepo.findOne.mockResolvedValue(
        makeAnnualTotal(INVESTOR_ID, CURRENT_YEAR, 10_000_000),
      );

      await expect(
        service.enforceCaps(INVESTOR_ID, 'institutional', 999_999, 'retail'),
      ).resolves.toBeUndefined();
    });
  });

  // ── recordInvestment ─────────────────────────────────────────────────────

  describe('recordInvestment', () => {
    it('creates a new record when none exists', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      await service.recordInvestment(INVESTOR_ID, 2_000);

      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ investorId: INVESTOR_ID, totalUsd: 2_000 }),
      );
    });

    it('adds amount to existing record', async () => {
      const existing = makeAnnualTotal(INVESTOR_ID, CURRENT_YEAR, 3_000);
      mockRepo.findOne.mockResolvedValue(existing);

      await service.recordInvestment(INVESTOR_ID, 2_000);

      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ totalUsd: 5_000 }),
      );
    });
  });

  // ── getAnnualTotal ───────────────────────────────────────────────────────

  describe('getAnnualTotal', () => {
    it('returns 0 when no record exists', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      const total = await service.getAnnualTotal(INVESTOR_ID);
      expect(total).toBe(0);
    });

    it('returns the stored total', async () => {
      mockRepo.findOne.mockResolvedValue(
        makeAnnualTotal(INVESTOR_ID, CURRENT_YEAR, 7_500),
      );
      const total = await service.getAnnualTotal(INVESTOR_ID);
      expect(total).toBe(7_500);
    });
  });

  // ── resetAnnualTotals ────────────────────────────────────────────────────

  describe('resetAnnualTotals', () => {
    it('executes the upsert SQL with correct year parameters', async () => {
      mockRepo.query.mockResolvedValue([]);
      await service.resetAnnualTotals(2027);
      expect(mockRepo.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO annual_investment_totals'),
        [2027, 2026],
      );
    });
  });
});
