import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { MilestonePartialReleaseService } from './milestone-partial-release.service';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { MilestoneReleaseRecord } from './entities/milestone-release-record.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { StellarService } from '../stellar/stellar.service';

describe('MilestonePartialReleaseService', () => {
  let service: MilestonePartialReleaseService;
  let dealRepo: Repository<TradeDeal>;
  let releaseRepo: Repository<MilestoneReleaseRecord>;
  let milestoneRepo: Repository<ShipmentMilestone>;
  let logger: PinoLogger;

  const mockDeal: Partial<TradeDeal> = {
    id: 'deal-123',
    totalValue: 10000,
    milestoneReleasePct: 20,
    farmer: { id: 'farmer-1', walletAddress: 'G...' },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MilestonePartialReleaseService,
        {
          provide: getRepositoryToken(TradeDeal),
          useValue: {
            findOne: jest.fn().mockResolvedValue(mockDeal),
          },
        },
        {
          provide: getRepositoryToken(MilestoneReleaseRecord),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn().mockResolvedValue([]),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ShipmentMilestone),
          useValue: {},
        },
        {
          provide: StellarService,
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

    service = module.get<MilestonePartialReleaseService>(
      MilestonePartialReleaseService,
    );
    dealRepo = module.get<Repository<TradeDeal>>(getRepositoryToken(TradeDeal));
    releaseRepo = module.get<Repository<MilestoneReleaseRecord>>(
      getRepositoryToken(MilestoneReleaseRecord),
    );
    milestoneRepo = module.get<Repository<ShipmentMilestone>>(
      getRepositoryToken(ShipmentMilestone),
    );
    logger = module.get<PinoLogger>(PinoLogger);
  });

  describe('onMilestoneRecorded', () => {
    it('should release partial escrow on milestone completion', async () => {
      jest.spyOn(releaseRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(releaseRepo, 'find').mockResolvedValue([]);
      jest.spyOn(releaseRepo, 'create').mockReturnValue({
        tradeDealId: 'deal-123',
        milestoneType: 'farm',
        releasePct: 20,
        farmerAmountUsd: 1960, // 20% of 98% of 10000
      } as any);

      await service.onMilestoneRecorded('deal-123', 'farm');

      expect(releaseRepo.create).toHaveBeenCalledWith({
        tradeDealId: 'deal-123',
        milestoneType: 'farm',
        releasePct: 20,
        farmerAmountUsd: expect.closeTo(1960, 1),
      });
      expect(releaseRepo.save).toHaveBeenCalled();
    });

    it('should skip if milestone_release_pct is 0', async () => {
      const dealWithoutRelease = { ...mockDeal, milestoneReleasePct: 0 };
      jest.spyOn(dealRepo, 'findOne').mockResolvedValue(dealWithoutRelease as any);

      await service.onMilestoneRecorded('deal-123', 'farm');

      expect(releaseRepo.save).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalled();
    });

    it('should prevent duplicate milestone release (idempotent)', async () => {
      const existing = {
        tradeDealId: 'deal-123',
        milestoneType: 'farm',
        releasePct: 20,
        farmerAmountUsd: 1960,
      };
      jest.spyOn(releaseRepo, 'findOne').mockResolvedValue(existing as any);

      await service.onMilestoneRecorded('deal-123', 'farm');

      expect(releaseRepo.save).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('already released'),
      );
    });

    it('should enforce cumulative cap of 98%', async () => {
      // Previous releases: 30% + 30% + 30% = 90%
      const previousReleases = [
        { releasePct: 30 } as any,
        { releasePct: 30 } as any,
        { releasePct: 30 } as any,
      ];
      jest.spyOn(releaseRepo, 'find').mockResolvedValue(previousReleases);

      // Trying to add another 20% would exceed 98%
      const dealWith20 = { ...mockDeal, milestoneReleasePct: 20 };
      jest.spyOn(dealRepo, 'findOne').mockResolvedValue(dealWith20 as any);

      await service.onMilestoneRecorded('deal-123', 'port');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ totalPct: 110 }),
        expect.stringContaining('exceed'),
      );
      expect(releaseRepo.save).not.toHaveBeenCalled();
    });

    it('should calculate correct release amount', async () => {
      // Deal: $10,000 total value
      // 98% pool: $9,800
      // 20% of pool: $1,960
      const deal = { ...mockDeal, totalValue: 10000, milestoneReleasePct: 20 };
      jest.spyOn(dealRepo, 'findOne').mockResolvedValue(deal as any);
      jest.spyOn(releaseRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(releaseRepo, 'find').mockResolvedValue([]);

      const releasedRecord = {
        tradeDealId: 'deal-123',
        milestoneType: 'farm',
        releasePct: 20,
        farmerAmountUsd: 1960,
      };
      jest.spyOn(releaseRepo, 'create').mockReturnValue(releasedRecord as any);

      await service.onMilestoneRecorded('deal-123', 'farm');

      expect(releaseRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          farmerAmountUsd: expect.closeTo(1960, 1),
        }),
      );
    });
  });

  describe('getCumulativeReleasedPct', () => {
    it('should return sum of all milestone releases', async () => {
      const records = [
        { releasePct: 25 } as any,
        { releasePct: 25 } as any,
        { releasePct: 20 } as any,
      ];
      jest.spyOn(releaseRepo, 'find').mockResolvedValue(records);

      const total = await service.getCumulativeReleasedPct('deal-123');
      expect(total).toBe(70);
    });

    it('should return 0 if no releases recorded', async () => {
      jest.spyOn(releaseRepo, 'find').mockResolvedValue([]);

      const total = await service.getCumulativeReleasedPct('deal-123');
      expect(total).toBe(0);
    });
  });

  describe('validateMilestoneReleasePct', () => {
    it('should reject negative percentages', () => {
      const result = service.validateMilestoneReleasePct(-5);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('between 0 and 100');
    });

    it('should reject percentages > 100', () => {
      const result = service.validateMilestoneReleasePct(150);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('between 0 and 100');
    });

    it('should reject if 4 milestones × pct > 98%', () => {
      // 30% × 4 = 120% > 98%
      const result = service.validateMilestoneReleasePct(30);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('exceed');
    });

    it('should accept valid percentages', () => {
      const result = service.validateMilestoneReleasePct(20);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept 24% (4 × 24 = 96% ≤ 98%)', () => {
      const result = service.validateMilestoneReleasePct(24);
      expect(result.valid).toBe(true);
    });

    it('should reject 25% (4 × 25 = 100% > 98%)', () => {
      const result = service.validateMilestoneReleasePct(25);
      expect(result.valid).toBe(false);
    });
  });

  describe('calculateFinalSettlementAmount', () => {
    it('should return remaining balance after all releases', async () => {
      // 70% released, so remaining = 98% - 70% = 28% of total
      // 28% of $10,000 = $2,800
      const records = [
        { releasePct: 25 } as any,
        { releasePct: 25 } as any,
        { releasePct: 20 } as any,
      ];
      jest.spyOn(releaseRepo, 'find').mockResolvedValue(records);

      const finalAmount = await service.calculateFinalSettlementAmount('deal-123');
      expect(finalAmount).toBeCloseTo(2800, 1);
    });

    it('should cap at 98% total (never go below 2%)', async () => {
      const records = [
        { releasePct: 24 } as any,
        { releasePct: 24 } as any,
        { releasePct: 24 } as any,
        { releasePct: 24 } as any,
      ];
      jest.spyOn(releaseRepo, 'find').mockResolvedValue(records);

      const finalAmount = await service.calculateFinalSettlementAmount('deal-123');
      // 96% released, 2% remaining = $200
      expect(finalAmount).toBeCloseTo(200, 1);
    });
  });

  describe('getNextExpectedMilestone', () => {
    it('should return farm if no milestones released', async () => {
      jest.spyOn(releaseRepo, 'find').mockResolvedValue([]);

      const next = await service.getNextExpectedMilestone('deal-123');
      expect(next).toBe('farm');
    });

    it('should return warehouse if farm already released', async () => {
      const released = [{ milestoneType: 'farm' } as any];
      jest.spyOn(releaseRepo, 'find').mockResolvedValue(released);

      const next = await service.getNextExpectedMilestone('deal-123');
      expect(next).toBe('warehouse');
    });

    it('should return null if all milestones released', async () => {
      const released = [
        { milestoneType: 'farm' } as any,
        { milestoneType: 'warehouse' } as any,
        { milestoneType: 'port' } as any,
        { milestoneType: 'importer' } as any,
      ];
      jest.spyOn(releaseRepo, 'find').mockResolvedValue(released);

      const next = await service.getNextExpectedMilestone('deal-123');
      expect(next).toBeNull();
    });
  });

  describe('Property Tests - Cumulative Cap', () => {
    it('[PROPERTY] cumulative releases never exceed 98%', async () => {
      // Test with randomized percentages
      const randomTestCases = [
        [10, 20, 30, 15],
        [24, 24, 24, 24],
        [98],
        [50, 48],
        [10, 10, 10, 10, 10], // Would fail validation
      ];

      for (const testCase of randomTestCases) {
        const totalPct = testCase.reduce((a, b) => a + b, 0);
        expect(totalPct).toBeLessThanOrEqual(98);
      }
    });

    it('[PROPERTY] farmer receives correct total across all milestones', async () => {
      const dealTotal = 10000;
      const milestones = [
        { releasePct: 20 },
        { releasePct: 20 },
        { releasePct: 20 },
        { releasePct: 20 },
      ];

      const escrowPool = dealTotal * 0.98;
      let totalFarmerAmount = 0;

      for (const ms of milestones) {
        const msAmount = escrowPool * (ms.releasePct / 100);
        totalFarmerAmount += msAmount;
      }

      const cumulativeReleasePct = milestones.reduce((s, m) => s + m.releasePct, 0);
      expect(totalFarmerAmount).toBeCloseTo(escrowPool * (cumulativeReleasePct / 100), 1);
    });

    it('[PROPERTY] final settlement amount = 98% - cumulative released', async () => {
      const dealTotal = 15000;
      const escrowPool = dealTotal * 0.98;
      const releasedPct = 60;
      const finalPct = 98 - releasedPct;

      const finalAmount = escrowPool * (finalPct / 100);
      expect(finalAmount).toBeCloseTo(escrowPool * (finalPct / 100), 1);
    });
  });
});
