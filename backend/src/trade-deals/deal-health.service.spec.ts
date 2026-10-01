import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { DealHealthService } from './deal-health.service';
import { TradeDeal } from './entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { RiskScoringService } from './risk-scoring.service';

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function buildDeal(overrides: Partial<TradeDeal> = {}): TradeDeal {
  return {
    id: 'deal-uuid-1',
    commodity: 'Cocoa',
    tokenSymbol: 'COC001',
    totalValue: 10_000,
    totalInvested: 5_000,
    status: 'open',
    farmerId: 'farmer-1',
    traderId: 'trader-1',
    createdAt: daysAgo(50),
    deliveryDate: daysFromNow(50),
    durationDays: 100,
    ...overrides,
  } as unknown as TradeDeal;
}

function buildMilestones(
  dealId: string,
  types: Array<'farm' | 'warehouse' | 'port' | 'importer'>,
): Partial<ShipmentMilestone>[] {
  return types.map((milestone, i) => ({
    id: `m-${i}`,
    tradeDealId: dealId,
    milestone,
    recordedAt: daysAgo(40 - i * 5),
  }));
}

const mockTradeDealRepo = () => ({
  findOne: jest.fn(),
});

const mockInvestmentRepo = () => ({
  find: jest.fn().mockResolvedValue([]),
});

const mockMilestoneRepo = () => ({
  find: jest.fn().mockResolvedValue([]),
});

const mockRiskScoringService = () => ({
  computeScore: jest.fn(),
});

describe('DealHealthService', () => {
  let service: DealHealthService;
  let tradeDealRepo: ReturnType<typeof mockTradeDealRepo>;
  let investmentRepo: ReturnType<typeof mockInvestmentRepo>;
  let milestoneRepo: ReturnType<typeof mockMilestoneRepo>;
  let riskScoringService: ReturnType<typeof mockRiskScoringService>;

  beforeEach(async () => {
    tradeDealRepo = mockTradeDealRepo();
    investmentRepo = mockInvestmentRepo();
    milestoneRepo = mockMilestoneRepo();
    riskScoringService = mockRiskScoringService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DealHealthService,
        { provide: getRepositoryToken(TradeDeal), useValue: tradeDealRepo },
        { provide: getRepositoryToken(Investment), useValue: investmentRepo },
        {
          provide: getRepositoryToken(ShipmentMilestone),
          useValue: milestoneRepo,
        },
        { provide: RiskScoringService, useValue: riskScoringService },
      ],
    }).compile();

    service = module.get<DealHealthService>(DealHealthService);
  });

  afterEach(() => jest.clearAllMocks());

  it('throws NotFoundException when the deal does not exist', async () => {
    tradeDealRepo.findOne.mockResolvedValue(null);

    await expect(service.getDealHealth('missing-deal')).rejects.toThrow(
      NotFoundException,
    );
  });

  describe('status = Healthy', () => {
    it('is Healthy when funding and milestones are on pace and risk is Low/Medium', async () => {
      // 50 / 100 days elapsed -> expected pace 50%
      const deal = buildDeal({
        totalValue: 10_000,
        totalInvested: 5_000, // raisedPct 50% == expected 50%
        createdAt: daysAgo(50),
        deliveryDate: daysFromNow(50),
        durationDays: 100,
        status: 'open',
      });
      tradeDealRepo.findOne.mockResolvedValue(deal);
      riskScoringService.computeScore.mockResolvedValue({
        score: 30,
        rating: 'Medium',
        breakdown: {},
      });
      // expectedCountByNow = round(0.5 * 4) = 2 -> on pace with 2 completed
      milestoneRepo.find.mockResolvedValue(
        buildMilestones(deal.id, ['farm', 'warehouse']),
      );

      const result = await service.getDealHealth(deal.id);

      expect(result.status).toBe('Healthy');
      expect(result.funding.raisedPct).toBe(50);
      expect(result.milestones.completedCount).toBe(2);
    });
  });

  describe('status = Warning', () => {
    it('is Warning when funding is moderately behind expected pace (15-30pt gap)', async () => {
      const deal = buildDeal({
        totalValue: 10_000,
        totalInvested: 3_000, // raisedPct 30%, expected 50% -> gap 20
        createdAt: daysAgo(50),
        deliveryDate: daysFromNow(50),
        durationDays: 100,
        status: 'open',
      });
      tradeDealRepo.findOne.mockResolvedValue(deal);
      riskScoringService.computeScore.mockResolvedValue({
        score: 30,
        rating: 'Medium',
        breakdown: {},
      });
      milestoneRepo.find.mockResolvedValue(
        buildMilestones(deal.id, ['farm', 'warehouse']),
      );

      const result = await service.getDealHealth(deal.id);

      expect(result.status).toBe('Warning');
    });

    it('is Warning when milestones are one behind the expected schedule', async () => {
      const deal = buildDeal({
        totalValue: 10_000,
        totalInvested: 5_000, // on pace funding
        createdAt: daysAgo(50),
        deliveryDate: daysFromNow(50),
        durationDays: 100,
        status: 'open',
      });
      tradeDealRepo.findOne.mockResolvedValue(deal);
      riskScoringService.computeScore.mockResolvedValue({
        score: 30,
        rating: 'Medium',
        breakdown: {},
      });
      // expectedCountByNow = 2, only 1 completed -> gap of 1
      milestoneRepo.find.mockResolvedValue(buildMilestones(deal.id, ['farm']));

      const result = await service.getDealHealth(deal.id);

      expect(result.status).toBe('Warning');
    });

    it('is Warning when the risk rating is High, even with on-pace funding/milestones', async () => {
      const deal = buildDeal({
        totalValue: 10_000,
        totalInvested: 5_000,
        createdAt: daysAgo(50),
        deliveryDate: daysFromNow(50),
        durationDays: 100,
        status: 'open',
      });
      tradeDealRepo.findOne.mockResolvedValue(deal);
      riskScoringService.computeScore.mockResolvedValue({
        score: 65,
        rating: 'High',
        breakdown: {},
      });
      milestoneRepo.find.mockResolvedValue(
        buildMilestones(deal.id, ['farm', 'warehouse']),
      );

      const result = await service.getDealHealth(deal.id);

      expect(result.status).toBe('Warning');
    });
  });

  describe('status = At-risk', () => {
    it('is At-risk when funding is below 30% with <=7 days remaining (mirrors DealHealthMonitorService threshold)', async () => {
      // durationDays 10, elapsed 3 days -> expected pace 30%, gap to actual is only 10pts
      // (not enough alone to trip the pace-based Warning/At-risk tiers), but
      // daysRemaining (7) and raisedPct (20%) trip the same critical-funding
      // condition as DealHealthMonitorService.checkFundingBelowThreshold.
      const deal = buildDeal({
        totalValue: 10_000,
        totalInvested: 2_000, // raisedPct 20%
        createdAt: daysAgo(3),
        deliveryDate: daysFromNow(7),
        durationDays: 10,
        status: 'open',
      });
      tradeDealRepo.findOne.mockResolvedValue(deal);
      riskScoringService.computeScore.mockResolvedValue({
        score: 30,
        rating: 'Medium',
        breakdown: {},
      });
      milestoneRepo.find.mockResolvedValue([]);

      const result = await service.getDealHealth(deal.id);

      expect(result.funding.daysRemaining).toBeLessThanOrEqual(7);
      expect(result.funding.raisedPct).toBeLessThan(30);
      expect(result.status).toBe('At-risk');
    });

    it('is At-risk when funding is severely behind expected pace (>=30pt gap), independent of days remaining', async () => {
      const deal = buildDeal({
        totalValue: 10_000,
        totalInvested: 2_000, // raisedPct 20%, expected 60% -> gap 40
        createdAt: daysAgo(60),
        deliveryDate: daysFromNow(40), // daysRemaining 40, well above the 7-day critical window
        durationDays: 100,
        status: 'open',
      });
      tradeDealRepo.findOne.mockResolvedValue(deal);
      riskScoringService.computeScore.mockResolvedValue({
        score: 30,
        rating: 'Medium',
        breakdown: {},
      });
      milestoneRepo.find.mockResolvedValue(
        buildMilestones(deal.id, ['farm', 'warehouse']),
      );

      const result = await service.getDealHealth(deal.id);

      expect(result.funding.daysRemaining).toBeGreaterThan(7);
      expect(result.status).toBe('At-risk');
    });

    it('is At-risk when the shipment is overdue on a funded deal (mirrors checkShipmentOverdue threshold)', async () => {
      const deal = buildDeal({
        totalValue: 10_000,
        totalInvested: 5_000,
        createdAt: daysAgo(50),
        deliveryDate: daysAgo(2), // overdue by 48h > 24h threshold
        durationDays: 48,
        status: 'funded',
      });
      tradeDealRepo.findOne.mockResolvedValue(deal);
      riskScoringService.computeScore.mockResolvedValue({
        score: 30,
        rating: 'Medium',
        breakdown: {},
      });
      milestoneRepo.find.mockResolvedValue(
        buildMilestones(deal.id, ['farm', 'warehouse', 'port', 'importer']),
      );

      const result = await service.getDealHealth(deal.id);

      expect(result.status).toBe('At-risk');
    });

    it('is At-risk when the risk rating is Very High, even with on-pace funding/milestones', async () => {
      const deal = buildDeal({
        totalValue: 10_000,
        totalInvested: 5_000,
        createdAt: daysAgo(50),
        deliveryDate: daysFromNow(50),
        durationDays: 100,
        status: 'open',
      });
      tradeDealRepo.findOne.mockResolvedValue(deal);
      riskScoringService.computeScore.mockResolvedValue({
        score: 90,
        rating: 'Very High',
        breakdown: {},
      });
      milestoneRepo.find.mockResolvedValue(
        buildMilestones(deal.id, ['farm', 'warehouse']),
      );

      const result = await service.getDealHealth(deal.id);

      expect(result.status).toBe('At-risk');
    });

    it('is At-risk when milestones are two or more behind the expected schedule', async () => {
      const deal = buildDeal({
        totalValue: 10_000,
        totalInvested: 5_000, // on pace funding
        createdAt: daysAgo(50),
        deliveryDate: daysFromNow(50),
        durationDays: 100,
        status: 'open',
      });
      tradeDealRepo.findOne.mockResolvedValue(deal);
      riskScoringService.computeScore.mockResolvedValue({
        score: 30,
        rating: 'Medium',
        breakdown: {},
      });
      // expectedCountByNow = 2, 0 completed -> gap of 2
      milestoneRepo.find.mockResolvedValue([]);

      const result = await service.getDealHealth(deal.id);

      expect(result.status).toBe('At-risk');
    });
  });
});
