import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ArchivalService } from './archival.service';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { TradeDealArchive } from './entities/trade-deal-archive.entity';
import { InvestmentArchive } from './entities/investment-archive.entity';
import { ShipmentMilestoneArchive } from './entities/shipment-milestone-archive.entity';

describe('ArchivalService', () => {
  let service: ArchivalService;
  let tradeDealRepo: any;
  let investmentRepo: any;
  let milestoneRepo: any;
  let tradeDealArchiveRepo: any;
  let investmentArchiveRepo: any;
  let milestoneArchiveRepo: any;
  let dataSource: any;

  const mockDeal: Partial<TradeDeal> = {
    id: 'deal-uuid-1',
    commodity: 'Wheat',
    quantity: 100,
    quantityUnit: 'kg',
    totalValue: 5000,
    tokenCount: 50,
    tokenSymbol: 'WHEAT-01',
    status: 'completed',
    farmerId: 'farmer-1',
    traderId: 'trader-1',
    totalInvested: 5000,
    deliveryDate: new Date('2022-01-01'),
    createdAt: new Date('2022-01-01'),
    deletedAt: null,
  };

  const mockInvestment: Partial<Investment> = {
    id: 'inv-uuid-1',
    tradeDealId: 'deal-uuid-1',
    investorId: 'investor-1',
    tokenAmount: 50,
    amountUsd: 5000,
    status: 'confirmed' as any,
    createdAt: new Date('2022-01-01'),
  };

  const mockMilestone: Partial<ShipmentMilestone> = {
    id: 'ms-uuid-1',
    tradeDealId: 'deal-uuid-1',
    milestone: 'port',
    recordedBy: 'inspector-1',
    recordedAt: new Date('2022-01-02'),
  };

  beforeEach(async () => {
    tradeDealRepo = { find: jest.fn(), update: jest.fn() };
    investmentRepo = { find: jest.fn(), update: jest.fn() };
    milestoneRepo = { find: jest.fn(), update: jest.fn() };
    tradeDealArchiveRepo = { find: jest.fn() };
    investmentArchiveRepo = { find: jest.fn() };
    milestoneArchiveRepo = { find: jest.fn() };

    dataSource = {
      transaction: jest.fn(async (cb: any) => {
        const manager = {
          find: jest.fn((entity: any) => {
            if (entity === TradeDeal) return Promise.resolve([mockDeal]);
            if (entity === Investment) return Promise.resolve([mockInvestment]);
            if (entity === ShipmentMilestone)
              return Promise.resolve([mockMilestone]);
            return Promise.resolve([]);
          }),
          create: jest.fn((entity: any, dto: any) => dto),
          save: jest.fn(() => Promise.resolve([])),
          update: jest.fn(() => Promise.resolve({ affected: 1 })),
          query: jest.fn(() => Promise.resolve([])),
        };
        return cb(manager);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArchivalService,
        { provide: getRepositoryToken(TradeDeal), useValue: tradeDealRepo },
        { provide: getRepositoryToken(Investment), useValue: investmentRepo },
        {
          provide: getRepositoryToken(ShipmentMilestone),
          useValue: milestoneRepo,
        },
        {
          provide: getRepositoryToken(TradeDealArchive),
          useValue: tradeDealArchiveRepo,
        },
        {
          provide: getRepositoryToken(InvestmentArchive),
          useValue: investmentArchiveRepo,
        },
        {
          provide: getRepositoryToken(ShipmentMilestoneArchive),
          useValue: milestoneArchiveRepo,
        },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<ArchivalService>(ArchivalService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('copyToArchive', () => {
    it('should copy eligible closed deals and related records to archive', async () => {
      const result = await service.copyToArchive(2);

      expect(result.dealsArchived).toBe(1);
      expect(result.investmentsArchived).toBe(1);
      expect(result.milestonesArchived).toBe(1);
      expect(dataSource.transaction).toHaveBeenCalled();
    });
  });

  describe('validateArchive', () => {
    it('should validate checksum and row counts matching archive tables', async () => {
      const softDeletedDeal = { ...mockDeal, deletedAt: new Date() };
      tradeDealRepo.find.mockResolvedValue([softDeletedDeal]);
      tradeDealArchiveRepo.find.mockResolvedValue([{ id: 'deal-uuid-1' }]);

      const result = await service.validateArchive(2);

      expect(result.valid).toBe(true);
      expect(result.primaryCount).toBe(1);
      expect(result.archiveCount).toBe(1);
      expect(result.primaryHash).toEqual(result.archiveHash);
    });

    it('should fail validation when count or checksum mismatches', async () => {
      const softDeletedDeal = { ...mockDeal, deletedAt: new Date() };
      tradeDealRepo.find.mockResolvedValue([softDeletedDeal]);
      tradeDealArchiveRepo.find.mockResolvedValue([]); // archive empty

      const result = await service.validateArchive(2);

      expect(result.valid).toBe(false);
      expect(result.primaryCount).toBe(1);
      expect(result.archiveCount).toBe(0);
    });
  });

  describe('hardDeleteValidatedArchives', () => {
    it('should throw an error if archive validation fails', async () => {
      jest.spyOn(service, 'validateArchive').mockResolvedValue({
        valid: false,
        primaryCount: 1,
        archiveCount: 0,
        primaryHash: 'abc',
        archiveHash: 'def',
      });

      await expect(service.hardDeleteValidatedArchives(30)).rejects.toThrow(
        'Archive checksum validation failed before hard delete.',
      );
    });

    it('should purge soft-deleted records when validation passes', async () => {
      jest.spyOn(service, 'validateArchive').mockResolvedValue({
        valid: true,
        primaryCount: 1,
        archiveCount: 1,
        primaryHash: 'abc',
        archiveHash: 'abc',
      });
      tradeDealRepo.find.mockResolvedValue([
        { id: 'deal-uuid-1', deletedAt: new Date('2020-01-01') },
      ]);

      const count = await service.hardDeleteValidatedArchives(30);

      expect(count).toBe(1);
    });
  });
});
