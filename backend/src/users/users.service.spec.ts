import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { TradeDeal } from './entities/trade-deal.entity';
import { Investment } from './entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { PaymentDistribution } from '../escrow/entities/payment-distribution.entity';

const mockDeal = (overrides = {}) => ({
  id: 'deal-1',
  commodity: 'Cocoa',
  status: 'open',
  totalValue: 10000,
  tokenCount: 100,
  ...overrides,
});

const mockInvestment = (overrides = {}) => ({
  id: 'inv-1',
  investorId: 'user-1',
  tokenAmount: 10,
  amountUsd: 1000,
  status: 'confirmed',
  stellarTxId: null,
  createdAt: new Date(),
  tradeDeal: mockDeal(),
  ...overrides,
});

describe('UsersService.getUserInvestments', () => {
  let service: UsersService;
  let investmentRepo: { find: jest.Mock };
  let paymentDistRepo: { findOne: jest.Mock };
import { Document } from '../trade-deals/entities/document.entity';
import { User } from '../auth/entities/user.entity';

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

  const userRepo = { findOne: jest.fn() };
  const tradeDealRepo = { find: jest.fn() };
  const investmentRepo = { find: jest.fn() };
  const milestoneRepo = { findOne: jest.fn() };
  const documentRepo = { createQueryBuilder: jest.fn() };

  // Helper to mock the GROUP BY query chain
  const mockDocumentCounts = (
    rows: { trade_deal_id: string; count: string }[],
  ) => {
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
    investmentRepo = { find: jest.fn() };
    paymentDistRepo = { findOne: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(TradeDeal), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(Investment), useValue: investmentRepo },
        { provide: getRepositoryToken(ShipmentMilestone), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(PaymentDistribution), useValue: paymentDistRepo },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  it('throws ForbiddenException for non-investor role', async () => {
    await expect(service.getUserInvestments('user-1', 'farmer')).rejects.toThrow(ForbiddenException);
  });

  it('calculates expected_return_usd as (tokenAmount / tokenCount) * totalValue', async () => {
    investmentRepo.find.mockResolvedValue([mockInvestment()]);
    paymentDistRepo.findOne.mockResolvedValue(null);

    const [result] = await service.getUserInvestments('user-1', 'investor');

    // (10 / 100) * 10000 = 1000
    expect(result.expected_return_usd).toBe(1000);
  });

  it('returns null actual_return_usd and return_percentage for non-completed deals', async () => {
    investmentRepo.find.mockResolvedValue([mockInvestment({ tradeDeal: mockDeal({ status: 'funded' }) })]);
    paymentDistRepo.findOne.mockResolvedValue(null);

    const [result] = await service.getUserInvestments('user-1', 'investor');

    expect(result.actual_return_usd).toBeNull();
    expect(result.return_percentage).toBeNull();
  });

  it('returns actual_return_usd from PaymentDistribution for completed deals', async () => {
    investmentRepo.find.mockResolvedValue([mockInvestment({ tradeDeal: mockDeal({ status: 'completed' }) })]);
    paymentDistRepo.findOne.mockResolvedValue({ amountUsd: 1200 });

    const [result] = await service.getUserInvestments('user-1', 'investor');

    expect(result.actual_return_usd).toBe(1200);
  });

  it('calculates return_percentage correctly for completed deals', async () => {
    // invested 1000, got back 1200 => 20%
    investmentRepo.find.mockResolvedValue([mockInvestment({ tradeDeal: mockDeal({ status: 'completed' }) })]);
    paymentDistRepo.findOne.mockResolvedValue({ amountUsd: 1200 });

    const [result] = await service.getUserInvestments('user-1', 'investor');

    expect(result.return_percentage).toBeCloseTo(20);
  });

  it('returns null actual_return_usd when no PaymentDistribution found for completed deal', async () => {
    investmentRepo.find.mockResolvedValue([mockInvestment({ tradeDeal: mockDeal({ status: 'completed' }) })]);
    paymentDistRepo.findOne.mockResolvedValue(null);

    const [result] = await service.getUserInvestments('user-1', 'investor');

    expect(result.actual_return_usd).toBeNull();
    expect(result.return_percentage).toBeNull();
  });
});
