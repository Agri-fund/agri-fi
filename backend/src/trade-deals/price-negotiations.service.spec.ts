import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PriceNegotiationsService } from './price-negotiations.service';
import {
  PriceNegotiation,
  PriceNegotiationStatus,
} from './entities/price-negotiation.entity';
import { TradeDeal } from './entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';

describe('PriceNegotiationsService (State Machine Transitions)', () => {
  let service: PriceNegotiationsService;
  let negotiationRepo: any;
  let tradeDealRepo: any;
  let userRepo: any;
  let notificationsService: any;

  const mockFarmerId = 'farmer-uuid-1';
  const mockTraderId = 'trader-uuid-2';
  const mockInvestorId = 'investor-uuid-3';
  const mockDealId = 'deal-uuid-100';

  const mockDeal: Partial<TradeDeal> = {
    id: mockDealId,
    commodity: 'Cocoa',
    title: 'Highland Premium Cocoa',
    status: 'open',
    totalValue: 50000,
    farmerId: mockFarmerId,
    traderId: mockTraderId,
  };

  const mockFarmerUser: Partial<User> = {
    id: mockFarmerId,
    email: 'farmer@example.com',
    fullName: 'Farmer John',
    role: 'farmer',
  };

  const mockTraderUser: Partial<User> = {
    id: mockTraderId,
    email: 'trader@example.com',
    fullName: 'Trader Jane',
    role: 'trader',
  };

  beforeEach(async () => {
    negotiationRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'neg-uuid-1', createdAt: new Date() })),
      save: jest.fn((entity) => Promise.resolve({ ...entity })),
      findOne: jest.fn(),
      find: jest.fn(),
      count: jest.fn(),
    };

    tradeDealRepo = {
      findOne: jest.fn().mockResolvedValue({ ...mockDeal }),
      save: jest.fn((entity) => Promise.resolve({ ...entity })),
    };

    userRepo = {
      find: jest.fn().mockResolvedValue([mockFarmerUser, mockTraderUser]),
      findOne: jest.fn(),
    };

    notificationsService = {
      createNotification: jest.fn().mockResolvedValue({}),
      sendEmail: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceNegotiationsService,
        {
          provide: getRepositoryToken(PriceNegotiation),
          useValue: negotiationRepo,
        },
        {
          provide: getRepositoryToken(TradeDeal),
          useValue: tradeDealRepo,
        },
        {
          provide: getRepositoryToken(User),
          useValue: userRepo,
        },
        {
          provide: NotificationsService,
          useValue: notificationsService,
        },
      ],
    }).compile();

    service = module.get<PriceNegotiationsService>(PriceNegotiationsService);
  });

  describe('submitProposal (State Machine Transitions)', () => {
    it('creates initial price proposal with PENDING status and notifies parties', async () => {
      negotiationRepo.count.mockResolvedValue(0);
      negotiationRepo.findOne.mockResolvedValue(null);

      const result = await service.submitProposal(
        mockDealId,
        mockFarmerId,
        'farmer',
        { proposed_price: 48000, message: 'Initial offer based on quality' },
      );

      expect(result.status).toBe(PriceNegotiationStatus.PENDING);
      expect(result.proposedPrice).toBe(48000);
      expect(result.proposerId).toBe(mockFarmerId);
      expect(negotiationRepo.save).toHaveBeenCalled();
      expect(notificationsService.createNotification).toHaveBeenCalled();
      expect(notificationsService.sendEmail).toHaveBeenCalled();
    });

    it('transitions existing PENDING proposal to COUNTERED when counter-offer is submitted', async () => {
      negotiationRepo.count.mockResolvedValue(1);
      const existingPending = {
        id: 'neg-1',
        dealId: mockDealId,
        proposerId: mockFarmerId,
        proposedPrice: 48000,
        status: PriceNegotiationStatus.PENDING,
      };
      negotiationRepo.findOne.mockResolvedValue(existingPending);

      const counterResult = await service.submitProposal(
        mockDealId,
        mockTraderId,
        'trader',
        { proposed_price: 46000, message: 'Counter offering 46k' },
      );

      expect(existingPending.status).toBe(PriceNegotiationStatus.COUNTERED);
      expect(counterResult.status).toBe(PriceNegotiationStatus.PENDING);
      expect(counterResult.proposedPrice).toBe(46000);
      expect(counterResult.proposerId).toBe(mockTraderId);
      expect(negotiationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: PriceNegotiationStatus.COUNTERED }),
      );
    });

    it('enforces maximum 10 rounds of negotiation per deal', async () => {
      negotiationRepo.count.mockResolvedValue(10);

      await expect(
        service.submitProposal(mockDealId, mockFarmerId, 'farmer', {
          proposed_price: 47000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects proposal submission if deal is finalized/completed', async () => {
      tradeDealRepo.findOne.mockResolvedValue({
        ...mockDeal,
        status: 'completed',
      });

      await expect(
        service.submitProposal(mockDealId, mockFarmerId, 'farmer', {
          proposed_price: 47000,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('forbids investors or non-participants from proposing prices', async () => {
      negotiationRepo.count.mockResolvedValue(0);

      await expect(
        service.submitProposal(mockDealId, mockInvestorId, 'investor', {
          proposed_price: 47000,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('respondToProposal (Accept & Reject Transitions)', () => {
    it('transitions PENDING proposal to ACCEPTED and automatically updates trade_deals.total_value', async () => {
      const pendingProposal = {
        id: 'neg-round-2',
        dealId: mockDealId,
        proposerId: mockFarmerId,
        proposedPrice: 47500,
        status: PriceNegotiationStatus.PENDING,
      };
      negotiationRepo.findOne.mockResolvedValue(pendingProposal);

      const result = await service.respondToProposal(
        mockDealId,
        'neg-round-2',
        mockTraderId,
        'trader',
        { status: PriceNegotiationStatus.ACCEPTED },
      );

      expect(result.status).toBe(PriceNegotiationStatus.ACCEPTED);
      expect(tradeDealRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          totalValue: 47500,
        }),
      );
      expect(notificationsService.createNotification).toHaveBeenCalled();
      expect(notificationsService.sendEmail).toHaveBeenCalled();
    });

    it('transitions PENDING proposal to REJECTED without modifying trade_deals.total_value', async () => {
      const pendingProposal = {
        id: 'neg-round-2',
        dealId: mockDealId,
        proposerId: mockFarmerId,
        proposedPrice: 47500,
        status: PriceNegotiationStatus.PENDING,
      };
      negotiationRepo.findOne.mockResolvedValue(pendingProposal);

      const result = await service.respondToProposal(
        mockDealId,
        'neg-round-2',
        mockTraderId,
        'trader',
        { status: PriceNegotiationStatus.REJECTED },
      );

      expect(result.status).toBe(PriceNegotiationStatus.REJECTED);
      // Deal totalValue must NOT be updated on rejection
      expect(tradeDealRepo.save).not.toHaveBeenCalled();
      expect(negotiationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: PriceNegotiationStatus.REJECTED }),
      );
    });

    it('forbids the proposer from accepting or rejecting their own proposal', async () => {
      const pendingProposal = {
        id: 'neg-round-2',
        dealId: mockDealId,
        proposerId: mockFarmerId,
        proposedPrice: 47500,
        status: PriceNegotiationStatus.PENDING,
      };
      negotiationRepo.findOne.mockResolvedValue(pendingProposal);

      await expect(
        service.respondToProposal(
          mockDealId,
          'neg-round-2',
          mockFarmerId,
          'farmer',
          { status: PriceNegotiationStatus.ACCEPTED },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if attempting to accept/reject an already resolved proposal', async () => {
      const alreadyAccepted = {
        id: 'neg-round-1',
        dealId: mockDealId,
        proposerId: mockFarmerId,
        proposedPrice: 47500,
        status: PriceNegotiationStatus.ACCEPTED,
      };
      negotiationRepo.findOne.mockResolvedValue(alreadyAccepted);

      await expect(
        service.respondToProposal(
          mockDealId,
          'neg-round-1',
          mockTraderId,
          'trader',
          { status: PriceNegotiationStatus.ACCEPTED },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if negotiation does not exist', async () => {
      negotiationRepo.findOne.mockResolvedValue(null);

      await expect(
        service.respondToProposal(
          mockDealId,
          'non-existent-id',
          mockTraderId,
          'trader',
          { status: PriceNegotiationStatus.ACCEPTED },
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getNegotiations (Access Control Visibility)', () => {
    it('allows farmer to view negotiation history', async () => {
      const history = [
        { id: 'neg-1', status: PriceNegotiationStatus.COUNTERED },
        { id: 'neg-2', status: PriceNegotiationStatus.PENDING },
      ];
      negotiationRepo.find.mockResolvedValue(history);

      const result = await service.getNegotiations(
        mockDealId,
        mockFarmerId,
        'farmer',
      );
      expect(result).toEqual(history);
    });

    it('allows trader to view negotiation history', async () => {
      const history = [
        { id: 'neg-1', status: PriceNegotiationStatus.COUNTERED },
      ];
      negotiationRepo.find.mockResolvedValue(history);

      const result = await service.getNegotiations(
        mockDealId,
        mockTraderId,
        'trader',
      );
      expect(result).toEqual(history);
    });

    it('forbids investors from viewing negotiation history', async () => {
      await expect(
        service.getNegotiations(mockDealId, mockInvestorId, 'investor'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
