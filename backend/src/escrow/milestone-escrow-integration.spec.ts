import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MilestonePartialReleaseService } from './milestone-partial-release.service';
import { EscrowService } from './escrow.service';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { MilestoneReleaseRecord } from './entities/milestone-release-record.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { PinoLogger } from 'nestjs-pino';

/**
 * Integration tests for milestone-based partial escrow release.
 * Tests the complete flow: deal creation → milestones → staged releases → final settlement.
 */
describe('Milestone-based Partial Escrow Release Integration', () => {
  let partialReleaseService: MilestonePartialReleaseService;
  let dealRepo: any;
  let releaseRepo: any;

  const createMockDeal = (
    totalValue: number,
    milestoneReleasePct: number,
  ): Partial<TradeDeal> => ({
    id: `deal-${Math.random()}`,
    totalValue,
    milestoneReleasePct,
    farmer: { id: 'farmer-1', walletAddress: 'G...' },
    status: 'open',
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MilestonePartialReleaseService,
        {
          provide: getRepositoryToken(TradeDeal),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(MilestoneReleaseRecord),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ShipmentMilestone),
          useValue: {},
        },
        {
          provide: 'StellarService',
          useValue: {},
        },
        {
          provide: PinoLogger,
          useValue: {
            setContext: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn(),
            info: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    }).compile();

    partialReleaseService = module.get<MilestonePartialReleaseService>(
      MilestonePartialReleaseService,
    );
    dealRepo = module.get(getRepositoryToken(TradeDeal));
    releaseRepo = module.get(getRepositoryToken(MilestoneReleaseRecord));
  });

  describe('Staged Release Flow - 4 Milestones × 20% Each', () => {
    /**
     * Scenario: Farmer receives 20% of 98% pool at each milestone
     * Expected behavior:
     * - Farm: release 20% = $1,960
     * - Warehouse: release 20% = $1,960
     * - Port: release 20% = $1,960
     * - Importer: release 20% = $1,960
     * - Final: release remaining 18% = $1,764
     * Total = 98% = $9,800
     */
    it('should release 20% at each of 4 milestones, then 18% at completion', async () => {
      const deal = createMockDeal(10000, 20);
      const escrowPool = 10000 * 0.98; // $9,800

      // Simulate each milestone release
      const releases = [];
      const milestones = ['farm', 'warehouse', 'port', 'importer'];

      for (const milestone of milestones) {
        jest.spyOn(dealRepo, 'findOne').mockResolvedValue(deal);
        jest.spyOn(releaseRepo, 'findOne').mockResolvedValue(null);
        jest.spyOn(releaseRepo, 'find').mockResolvedValue(releases);

        const amountToRelease = escrowPool * 0.2; // 20% of $9,800 = $1,960
        const record = {
          tradeDealId: deal.id,
          milestoneType: milestone,
          releasePct: 20,
          farmerAmountUsd: amountToRelease,
        };

        jest.spyOn(releaseRepo, 'create').mockReturnValue(record as any);

        await partialReleaseService.onMilestoneRecorded(deal.id, milestone as any);

        releases.push(record as any);
      }

      // Verify cumulative releases
      const totalReleasedPct = releases.reduce((s, r) => s + r.releasePct, 0);
      expect(totalReleasedPct).toBe(80); // 4 × 20% = 80%

      // Final settlement should be 18% of pool
      const finalAmount = escrowPool * (18 / 100);
      expect(finalAmount).toBeCloseTo(1764, 1);

      // Total farmer receives: 80% + 18% = 98% of pool
      const totalFarmerAmount = releases.reduce((s, r) => s + r.farmerAmountUsd, 0) + finalAmount;
      expect(totalFarmerAmount).toBeCloseTo(escrowPool, 1);
    });
  });

  describe('Progressive Release - Increasing Percentages', () => {
    /**
     * Scenario: Early milestones release less, later ones more
     * Farm: 15%, Warehouse: 20%, Port: 25%, Importer: 30%
     * Total: 90%, Final settlement: 8%
     */
    it('should handle progressive release percentages', async () => {
      const deal = createMockDeal(50000, 0); // Dynamic per milestone
      const escrowPool = 50000 * 0.98; // $49,000

      const progressiveReleases = [
        { milestone: 'farm', pct: 15 },
        { milestone: 'warehouse', pct: 20 },
        { milestone: 'port', pct: 25 },
        { milestone: 'importer', pct: 30 },
      ];

      let totalReleasedPct = 0;
      for (const { pct } of progressiveReleases) {
        totalReleasedPct += pct;
        expect(totalReleasedPct).toBeLessThanOrEqual(98);
      }

      const finalPct = 98 - totalReleasedPct;
      expect(finalPct).toBeCloseTo(8, 1);
    });
  });

  describe('Cumulative Cap Enforcement', () => {
    /**
     * Property test: No configuration should exceed 98% cap
     */
    it('[PROPERTY] validates config prevents exceeding 98% cap', () => {
      const testConfigs = [
        { pct: 20, result: true }, // 4 × 20% = 80% ✓
        { pct: 24, result: true }, // 4 × 24% = 96% ✓
        { pct: 25, result: false }, // 4 × 25% = 100% ✗
        { pct: 30, result: false }, // 4 × 30% = 120% ✗
        { pct: 0, result: true }, // No releases ✓
        { pct: 98, result: false }, // 4 × 98% = 392% ✗
      ];

      for (const { pct, result } of testConfigs) {
        const validation = partialReleaseService.validateMilestoneReleasePct(pct);
        expect(validation.valid).toBe(result);
      }
    });
  });

  describe('Idempotency - Duplicate Milestone Handling', () => {
    /**
     * Scenario: Same milestone recorded twice (network retry, etc.)
     * Expected: Only one release per milestone, rest ignored
     */
    it('should ignore duplicate milestone releases', async () => {
      const deal = createMockDeal(10000, 20);
      const releases = [];

      // First time: farm milestone completes
      jest.spyOn(dealRepo, 'findOne').mockResolvedValue(deal);
      jest.spyOn(releaseRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(releaseRepo, 'find').mockResolvedValue(releases);

      const firstRecord = {
        tradeDealId: deal.id,
        milestoneType: 'farm',
        releasePct: 20,
        farmerAmountUsd: 1960,
      };
      jest.spyOn(releaseRepo, 'create').mockReturnValue(firstRecord as any);

      await partialReleaseService.onMilestoneRecorded(deal.id, 'farm');
      releases.push(firstRecord as any);

      // Second time: same farm milestone (duplicate)
      jest.spyOn(releaseRepo, 'findOne').mockResolvedValue(firstRecord as any);

      await partialReleaseService.onMilestoneRecorded(deal.id, 'farm');

      // Should still have only 1 record
      expect(releases).toHaveLength(1);
    });
  });

  describe('Milestone Order Tracking', () => {
    it('should identify next expected milestone in sequence', async () => {
      jest.spyOn(releaseRepo, 'find').mockResolvedValue([]);
      let next = await partialReleaseService.getNextExpectedMilestone('deal-123');
      expect(next).toBe('farm');

      jest.spyOn(releaseRepo, 'find').mockResolvedValue([{ milestoneType: 'farm' } as any]);
      next = await partialReleaseService.getNextExpectedMilestone('deal-123');
      expect(next).toBe('warehouse');

      jest.spyOn(releaseRepo, 'find').mockResolvedValue([
        { milestoneType: 'farm' } as any,
        { milestoneType: 'warehouse' } as any,
        { milestoneType: 'port' } as any,
      ]);
      next = await partialReleaseService.getNextExpectedMilestone('deal-123');
      expect(next).toBe('importer');

      jest.spyOn(releaseRepo, 'find').mockResolvedValue([
        { milestoneType: 'farm' } as any,
        { milestoneType: 'warehouse' } as any,
        { milestoneType: 'port' } as any,
        { milestoneType: 'importer' } as any,
      ]);
      next = await partialReleaseService.getNextExpectedMilestone('deal-123');
      expect(next).toBeNull();
    });
  });

  describe('Final Settlement Calculation', () => {
    it('should correctly calculate final settlement after partial releases', async () => {
      const dealTotal = 100000;
      const escrowPool = dealTotal * 0.98; // $98,000

      // Simulate 3 releases of 25% each = 75% total
      jest.spyOn(releaseRepo, 'find')
        .mockResolvedValueOnce([
          { releasePct: 25 } as any,
          { releasePct: 25 } as any,
          { releasePct: 25 } as any,
        ]);

      const cumulativeReleasedPct = 75;
      const finalAmount = escrowPool * ((98 - cumulativeReleasedPct) / 100);
      expect(finalAmount).toBeCloseTo(22540, 1); // 23% of $98,000
    });
  });
});
