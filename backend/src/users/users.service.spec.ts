import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { TradeDeal } from './entities/trade-deal.entity';
import { Investment } from './entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { Document } from '../trade-deals/entities/document.entity';

const mockDeal = (id: string, overrides = {}): TradeDeal =>
  ({
    id,
    commodity: 'cocoa',
    quantity: 100,
    totalValue: 10000,
    totalInvested: 0,
    status: 'open',
    deliveryDate: new Date('2026-12-01'),
    farmerId: 'farmer-1',
    traderId: 'trader-1',
    ...overrides,
  }) as TradeDeal;

describe('UsersService', () => {
  let service: UsersService;

  const tradeDealRepo = { find: jest.fn() };
  const investmentRepo = { find: jest.fn() };
  const milestoneRepo = { findOne: jest.fn() };
  const documentRepo = { createQueryBuilder: jest.fn() };

  // Helper to mock the GROUP BY query chain
  const mockDocumentCounts = (rows: { trade_deal_id: string; count: string }[]) => {
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(rows),
    };
    documentRepo.createQueryBuilder.mockReturnValue(qb);
    return qb;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    milestoneRepo.findOne.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(TradeDeal), useValue: tradeDealRepo },
        { provide: getRepositoryToken(Investment), useValue: investmentRepo },
        { provide: getRepositoryToken(ShipmentMilestone), useValue: milestoneRepo },
        { provide: getRepositoryToken(Document), useValue: documentRepo },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('getUserDeals – document_count', () => {
    it('returns document_count: 0 when a deal has no documents', async () => {
      const deal = mockDeal('deal-1');
      tradeDealRepo.find.mockResolvedValue([deal]);
      mockDocumentCounts([]); // no rows returned

      const result = await service.getUserDeals('farmer-1', 'farmer');

      expect(result).toHaveLength(1);
      expect(result[0].document_count).toBe(0);
    });

    it('returns document_count: 1 when a deal has one document', async () => {
      const deal = mockDeal('deal-1');
      tradeDealRepo.find.mockResolvedValue([deal]);
      mockDocumentCounts([{ trade_deal_id: 'deal-1', count: '1' }]);

      const result = await service.getUserDeals('farmer-1', 'farmer');

      expect(result[0].document_count).toBe(1);
    });

    it('returns document_count: 5 when a deal has multiple documents', async () => {
      const deal = mockDeal('deal-1');
      tradeDealRepo.find.mockResolvedValue([deal]);
      mockDocumentCounts([{ trade_deal_id: 'deal-1', count: '5' }]);

      const result = await service.getUserDeals('farmer-1', 'farmer');

      expect(result[0].document_count).toBe(5);
    });

    it('returns correct counts for multiple deals in a single query', async () => {
      const deal1 = mockDeal('deal-1');
      const deal2 = mockDeal('deal-2');
      const deal3 = mockDeal('deal-3');
      tradeDealRepo.find.mockResolvedValue([deal1, deal2, deal3]);
      mockDocumentCounts([
        { trade_deal_id: 'deal-1', count: '0' },
        { trade_deal_id: 'deal-2', count: '3' },
        // deal-3 absent from results → should default to 0
      ]);

      const result = await service.getUserDeals('farmer-1', 'farmer');

      const byId = Object.fromEntries(result.map((r) => [r.id, r]));
      expect(byId['deal-1'].document_count).toBe(0);
      expect(byId['deal-2'].document_count).toBe(3);
      expect(byId['deal-3'].document_count).toBe(0);
    });

    it('issues exactly one GROUP BY query regardless of deal count', async () => {
      const deals = ['deal-1', 'deal-2', 'deal-3'].map((id) => mockDeal(id));
      tradeDealRepo.find.mockResolvedValue(deals);
      const qb = mockDocumentCounts([]);

      await service.getUserDeals('farmer-1', 'farmer');

      expect(documentRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(qb.getRawMany).toHaveBeenCalledTimes(1);
    });

    it('returns empty array without querying documents when user has no deals', async () => {
      tradeDealRepo.find.mockResolvedValue([]);

      const result = await service.getUserDeals('farmer-1', 'farmer');

      expect(result).toEqual([]);
      expect(documentRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for investor role', async () => {
      await expect(service.getUserDeals('investor-1', 'investor')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
