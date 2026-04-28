import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { PaymentDistribution } from '../escrow/entities/payment-distribution.entity';
import { Investment } from '../investments/entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { UsersService } from './users.service';

const mockTradeDeal = (overrides: Partial<TradeDeal> = {}): TradeDeal =>
  ({
    id: 'deal-1',
    commodity: 'cocoa',
    quantity: 100,
    totalValue: 10000,
    totalInvested: 2500,
    status: 'open',
    deliveryDate: new Date('2026-12-01'),
    farmerId: 'farmer-1',
    traderId: 'trader-1',
    ...overrides,
  }) as TradeDeal;

const mockInvestment = (overrides: Partial<Investment> = {}): Investment =>
  ({
    id: 'inv-1',
    investorId: 'investor-1',
    tradeDealId: 'deal-1',
    tokenAmount: 10,
    amountUsd: 1000,
    status: 'confirmed',
    stellarTxId: null,
    createdAt: new Date('2026-01-20'),
    tradeDeal: mockTradeDeal({
      tokenCount: 100,
      totalValue: 10000,
      status: 'open',
    }),
    ...overrides,
  }) as Investment;

describe('UsersService', () => {
  let service: UsersService;
  let userRepository: { findOne: jest.Mock };
  let tradeDealRepository: { find: jest.Mock };
  let investmentRepository: { find: jest.Mock };
  let milestoneRepository: { findOne: jest.Mock };
  let paymentDistributionRepository: { findOne: jest.Mock };

  beforeEach(async () => {
    userRepository = { findOne: jest.fn() };
    tradeDealRepository = { find: jest.fn() };
    investmentRepository = { find: jest.fn() };
    milestoneRepository = { findOne: jest.fn() };
    paymentDistributionRepository = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepository },
        {
          provide: getRepositoryToken(TradeDeal),
          useValue: tradeDealRepository,
        },
        {
          provide: getRepositoryToken(Investment),
          useValue: investmentRepository,
        },
        {
          provide: getRepositoryToken(ShipmentMilestone),
          useValue: milestoneRepository,
        },
        {
          provide: getRepositoryToken(PaymentDistribution),
          useValue: paymentDistributionRepository,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('getProfile', () => {
    it('returns the current user profile', async () => {
      userRepository.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'farmer@example.com',
        role: 'farmer',
        kycStatus: 'verified',
        walletAddress: 'GTESTWALLET',
        isCompany: false,
        companyDetails: null,
        country: 'GH',
        createdAt: new Date('2026-01-01'),
      });

      const result = await service.getProfile('user-1');

      expect(result).toEqual(
        expect.objectContaining({
          id: 'user-1',
          email: 'farmer@example.com',
          role: 'farmer',
        }),
      );
    });

    it('throws NotFoundException when user does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.getProfile('missing-user')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getUserDeals', () => {
    it('returns only farmer-owned deals when role is farmer', async () => {
      const farmerDeal = mockTradeDeal({
        id: 'deal-farmer-1',
        farmerId: 'farmer-123',
        traderId: 'trader-999',
      });

      tradeDealRepository.find.mockResolvedValue([farmerDeal]);
      milestoneRepository.findOne.mockResolvedValue({
        id: 'milestone-1',
        tradeDealId: 'deal-farmer-1',
      });

      const result = await service.getUserDeals('farmer-123', 'farmer');

      expect(tradeDealRepository.find).toHaveBeenCalledWith({
        where: { farmerId: 'farmer-123' },
        relations: ['farmer', 'trader', 'milestones'],
      });
      expect(result).toEqual([
        expect.objectContaining({
          id: 'deal-farmer-1',
          commodity: 'cocoa',
          total_value: 10000,
          total_invested: 2500,
          document_count: 0,
          latest_milestone: expect.objectContaining({ id: 'milestone-1' }),
        }),
      ]);
    });

    it('returns only trader-owned deals when role is trader', async () => {
      const traderDeal = mockTradeDeal({
        id: 'deal-trader-1',
        farmerId: 'farmer-888',
        traderId: 'trader-123',
      });

      tradeDealRepository.find.mockResolvedValue([traderDeal]);
      milestoneRepository.findOne.mockResolvedValue(null);

      const result = await service.getUserDeals('trader-123', 'trader');

      expect(tradeDealRepository.find).toHaveBeenCalledWith({
        where: { traderId: 'trader-123' },
        relations: ['farmer', 'trader', 'milestones'],
      });
      expect(result).toEqual([
        expect.objectContaining({
          id: 'deal-trader-1',
          latest_milestone: null,
          document_count: 0,
        }),
      ]);
    });

    it('rejects non farmer/trader roles', async () => {
      await expect(
        service.getUserDeals('investor-1', 'investor' as any),
      ).rejects.toThrow(ForbiddenException);

      expect(tradeDealRepository.find).not.toHaveBeenCalled();
    });
  });

  describe('getUserInvestments', () => {
    it('throws ForbiddenException for non-investor role', async () => {
      await expect(
        service.getUserInvestments('user-1', 'farmer'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('calculates expected and actual returns for completed deals', async () => {
      investmentRepository.find.mockResolvedValue([
        mockInvestment({
          tradeDeal: mockTradeDeal({
            id: 'deal-completed-1',
            tokenCount: 100,
            totalValue: 10000,
            status: 'completed',
          }),
        }),
      ]);
      paymentDistributionRepository.findOne.mockResolvedValue({
        amountUsd: 1200,
      });

      const [result] = await service.getUserInvestments(
        'investor-1',
        'investor',
      );

      expect(result.expected_return_usd).toBe(1000);
      expect(result.actual_return_usd).toBe(1200);
      expect(result.return_percentage).toBeCloseTo(20);
    });
  });
});
