import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InvestmentsService } from './investments.service';
import { Investment, InvestmentStatus } from './entities/investment.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { StellarService } from '../stellar/stellar.service';
import { QueueService } from '../queue/queue.service';
import { CreateInvestmentDto } from './dto/create-investment.dto';

const mockTradeDeal = (): TradeDeal => ({
  id: 'deal-1',
  commodity: 'Coffee',
  quantity: 1000,
  quantityUnit: 'kg',
  totalValue: 10000,
  tokenCount: 1000,
  tokenSymbol: 'COFFEE-001',
  status: 'open',
  farmerId: 'farmer-1',
  traderId: 'trader-1',
  escrowPublicKey: 'escrow-pub-key',
  escrowSecretKey: 'escrow-secret',
  issuerPublicKey: 'issuer-pub',
  totalInvested: 0,
  deliveryDate: new Date(),
  stellarAssetTxId: null,
  createdAt: new Date(),
  farmer: null,
  trader: null,
  documents: [],
  investments: [],
});

const mockInvestment = (): Investment => ({
  id: 'inv-1',
  tradeDealId: 'deal-1',
  investorId: 'investor-1',
  tokenAmount: 100,
  amountUsd: 1000,
  stellarTxId: null,
  complianceData: null,
  status: InvestmentStatus.PENDING,
  createdAt: new Date(),
  tradeDeal: null,
  investor: null,
});

describe('InvestmentsService', () => {
  let service: InvestmentsService;
  let investmentRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    findAndCount: jest.Mock;
  };
  let tradeDealRepo: { findOne: jest.Mock; update: jest.Mock };
  let stellarService: { fundEscrow: jest.MockedFunction<any> };
  let queueService: { enqueueInvestmentFund: jest.MockedFunction<any> };

  beforeEach(async () => {
    investmentRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      findAndCount: jest.fn(),
    };
    tradeDealRepo = { findOne: jest.fn(), update: jest.fn() };
    stellarService = { fundEscrow: jest.fn() };
    queueService = {
      enqueueInvestmentFund: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvestmentsService,
        { provide: getRepositoryToken(Investment), useValue: investmentRepo },
        { provide: getRepositoryToken(TradeDeal), useValue: tradeDealRepo },
        { provide: StellarService, useValue: stellarService },
        { provide: QueueService, useValue: queueService },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn((cb) =>
              cb({
                update: jest.fn((entity, criteria, values) => {
                  // Route calls through the existing repo mocks so tests can assert on them
                  if (entity === Investment) {
                    return investmentRepo.update(criteria, values);
                  }
                  return tradeDealRepo.update(criteria, values);
                }),
                find: jest.fn((entity, opts) => investmentRepo.find(opts)),
                create: jest.fn(),
                save: jest.fn(),
              }),
            ),
          },
        },
      ],
    }).compile();

    service = module.get<InvestmentsService>(InvestmentsService);
  });

  describe('createInvestment', () => {
    it('creates a pending investment record', async () => {
      const deal = mockTradeDeal();
      const dto: CreateInvestmentDto = {
        tradeDealId: 'deal-1',
        tokenAmount: 100,
        amountUsd: 1000,
      };

      tradeDealRepo.findOne.mockResolvedValue(deal);
      investmentRepo.find.mockResolvedValue([]);
      investmentRepo.create.mockReturnValue(mockInvestment());
      investmentRepo.save.mockResolvedValue(mockInvestment());

      const result = await service.createInvestment('investor-1', dto);

      expect(result.status).toBe(InvestmentStatus.PENDING);
      expect(investmentRepo.create).toHaveBeenCalledWith({
        tradeDealId: dto.tradeDealId,
        investorId: 'investor-1',
        tokenAmount: dto.tokenAmount,
        amountUsd: dto.amountUsd,
        status: InvestmentStatus.PENDING,
        complianceData: null,
      });
    });

    it('throws error when trade deal not found', async () => {
      const dto: CreateInvestmentDto = {
        tradeDealId: 'non-existent',
        tokenAmount: 100,
        amountUsd: 1000,
      };

      tradeDealRepo.findOne.mockResolvedValue(null);

      await expect(service.createInvestment('investor-1', dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws error when deal is not open', async () => {
      const deal = { ...mockTradeDeal(), status: 'funded' };
      const dto: CreateInvestmentDto = {
        tradeDealId: 'deal-1',
        tokenAmount: 100,
        amountUsd: 1000,
      };

      tradeDealRepo.findOne.mockResolvedValue(deal);

      await expect(service.createInvestment('investor-1', dto)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('checks token availability', async () => {
      const deal = mockTradeDeal();
      const dto: CreateInvestmentDto = {
        tradeDealId: 'deal-1',
        tokenAmount: 1100, // More than available
        amountUsd: 11000,
      };

      tradeDealRepo.findOne.mockResolvedValue(deal);
      investmentRepo.find.mockResolvedValue([]);

      await expect(service.createInvestment('investor-1', dto)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('rejects over-funding', async () => {
      const deal = mockTradeDeal();
      const dto: CreateInvestmentDto = {
        tradeDealId: 'deal-1',
        tokenAmount: 100,
        amountUsd: 11000, // More than total value
      };

      tradeDealRepo.findOne.mockResolvedValue(deal);
      investmentRepo.find.mockResolvedValue([]);

      await expect(service.createInvestment('investor-1', dto)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });
  });

  describe('confirmInvestment', () => {
    it('increments total_invested on confirmation', async () => {
      const investment = {
        ...mockInvestment(),
        status: InvestmentStatus.PENDING,
        tradeDeal: mockTradeDeal(),
      };

      investmentRepo.findOne.mockResolvedValue(investment);
      investmentRepo.save.mockResolvedValue({
        ...investment,
        status: InvestmentStatus.CONFIRMED,
      });
      investmentRepo.find.mockResolvedValue([investment]);
      tradeDealRepo.update.mockResolvedValue({ affected: 1 });

      await service.confirmInvestment('inv-1', 'stellar-tx-123');

      expect(investmentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: InvestmentStatus.CONFIRMED,
          stellarTxId: 'stellar-tx-123',
        }),
      );

      expect(tradeDealRepo.update).toHaveBeenCalledWith('deal-1', {
        totalInvested: 1000,
      });
    });

    it('transitions deal to funded status when fully funded', async () => {
      const investment = {
        ...mockInvestment(),
        status: InvestmentStatus.PENDING,
        tradeDeal: { ...mockTradeDeal(), totalValue: 1000 },
      };

      investmentRepo.findOne.mockResolvedValue(investment);
      investmentRepo.save.mockResolvedValue({
        ...investment,
        status: InvestmentStatus.CONFIRMED,
      });
      investmentRepo.find.mockResolvedValue([investment]);
      tradeDealRepo.update.mockResolvedValue({ affected: 1 });

      await service.confirmInvestment('inv-1', 'stellar-tx-123');

      expect(tradeDealRepo.update).toHaveBeenCalledWith('deal-1', {
        totalInvested: 1000,
      });
      expect(tradeDealRepo.update).toHaveBeenCalledWith(
        { id: 'deal-1', status: 'open' },
        { status: 'funded' },
      );
    });

    it('throws error for non-pending investments', async () => {
      const investment = {
        ...mockInvestment(),
        status: InvestmentStatus.CONFIRMED,
      };

      investmentRepo.findOne.mockResolvedValue(investment);

      await expect(
        service.confirmInvestment('inv-1', 'stellar-tx-123'),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('fundEscrow', () => {
    it('funds escrow and auto-confirms investment', async () => {
      const investment = {
        ...mockInvestment(),
        status: InvestmentStatus.PENDING,
        tradeDeal: mockTradeDeal(),
      };

      investmentRepo.findOne.mockResolvedValue(investment);
      investmentRepo.save.mockResolvedValue({
        ...investment,
        status: InvestmentStatus.CONFIRMED,
      });
      investmentRepo.find.mockResolvedValue([investment]);
      tradeDealRepo.update.mockResolvedValue({ affected: 1 });
      stellarService.fundEscrow.mockResolvedValue('stellar-tx-456');

      const result = await service.fundEscrow(
        'inv-1',
        'investor-wallet-address',
      );

      expect(stellarService.fundEscrow).toHaveBeenCalledWith(
        'escrow-pub-key',
        'investor-wallet-address',
        '1000',
        'escrow-secret',
        'COFFEE-001',
        100,
      );

      expect(result.stellarTxId).toBe('stellar-tx-456');
      expect(investmentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: InvestmentStatus.CONFIRMED,
          stellarTxId: 'stellar-tx-456',
        }),
      );
    });

    it('enqueues investment.fund job when signedXdr is provided', async () => {
      const investment = {
        ...mockInvestment(),
        status: InvestmentStatus.PENDING,
        tradeDeal: mockTradeDeal(),
      };

      investmentRepo.findOne.mockResolvedValue(investment);

      const result = await service.fundEscrow(
        'inv-1',
        'investor-wallet-address',
        'signed-xdr-payload',
      );

      expect(queueService.enqueueInvestmentFund).toHaveBeenCalledWith(
        expect.objectContaining({
          investmentId: 'inv-1',
          signedXdr: 'signed-xdr-payload',
          escrowPublicKey: 'escrow-pub-key',
          investorWallet: 'investor-wallet-address',
          tokenAmount: 100,
          amountUsd: 1000,
        }),
      );
      expect(result.stellarTxId).toBe('queued');
    });

    it('does NOT modify total_invested when Stellar fails', async () => {
      const investment = {
        ...mockInvestment(),
        status: InvestmentStatus.PENDING,
        tradeDeal: mockTradeDeal(),
      };

      investmentRepo.findOne.mockResolvedValue(investment);
      stellarService.fundEscrow.mockRejectedValue(
        new Error('Stellar network error'),
      );

      await expect(
        service.fundEscrow('inv-1', 'investor-wallet-address'),
      ).rejects.toThrow('Stellar network error');

      // total_invested must NOT be updated
      expect(tradeDealRepo.update).not.toHaveBeenCalled();
    });

    it('throws error when investment not found', async () => {
      investmentRepo.findOne.mockResolvedValue(null);

      await expect(
        service.fundEscrow('non-existent', 'wallet-address'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws error when escrow account not set', async () => {
      const investment = {
        ...mockInvestment(),
        status: InvestmentStatus.PENDING,
        tradeDeal: { ...mockTradeDeal(), escrowPublicKey: null },
      };

      investmentRepo.findOne.mockResolvedValue(investment);

      await expect(
        service.fundEscrow('inv-1', 'wallet-address'),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('markInvestmentFailed', () => {
    it('sets investment status to failed without touching total_invested', async () => {
      investmentRepo.update.mockResolvedValue({ affected: 1 });

      await service.markInvestmentFailed('inv-1');

      expect(investmentRepo.update).toHaveBeenCalledWith('inv-1', {
        status: InvestmentStatus.FAILED,
      });
      expect(tradeDealRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('getInvestmentsByTradeDeal', () => {
    it('returns investments for a trade deal', async () => {
      const investments = [mockInvestment()];
      investmentRepo.findAndCount.mockResolvedValue([investments, 1]);

      const result = await service.getInvestmentsByTradeDeal('deal-1');

      expect(investmentRepo.findAndCount).toHaveBeenCalledWith({
        where: { tradeDealId: 'deal-1' },
        relations: ['investor'],
        order: { createdAt: 'DESC' },
        skip: 0,
        take: 20,
      });
      expect(result.data).toEqual(investments);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('getInvestmentsByInvestor', () => {
    it('returns investments for an investor', async () => {
      const investments = [mockInvestment()];
      investmentRepo.findAndCount.mockResolvedValue([investments, 1]);

      const result = await service.getInvestmentsByInvestor('investor-1');

      expect(investmentRepo.findAndCount).toHaveBeenCalledWith({
        where: { investorId: 'investor-1' },
        relations: ['tradeDeal'],
        order: { createdAt: 'DESC' },
        skip: 0,
        take: 20,
      });
      expect(result.data).toEqual(investments);
      expect(result.meta.total).toBe(1);
    });
  });
});
