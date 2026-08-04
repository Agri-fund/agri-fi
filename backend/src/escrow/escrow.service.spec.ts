import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EscrowService } from './escrow.service';
import { PaymentDistribution } from './entities/payment-distribution.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { User } from '../auth/entities/user.entity';
import { StellarService } from '../stellar/stellar.service';
import { QueueService } from '../queue/queue.service';
import { PinoLogger } from 'nestjs-pino';

describe('EscrowService', () => {
  let service: EscrowService;
  let mockPaymentDistributionRepo: jest.Mocked<Repository<PaymentDistribution>>;
  let mockTradeDealRepo: jest.Mocked<Repository<TradeDeal>>;
  let mockInvestmentRepo: jest.Mocked<Repository<Investment>>;
  let mockUserRepo: jest.Mocked<Repository<User>>;
  let mockStellarService: jest.Mocked<StellarService>;
  let mockQueueService: jest.Mocked<QueueService>;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockDataSource: jest.Mocked<DataSource>;
  let mockQueryRunnerManager: {
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let mockQueryRunner: {
    connect: jest.Mock;
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
    manager: typeof mockQueryRunnerManager;
  };

  const setupDealMocks = (
    mockDeal: Record<string, unknown>,
    mockInvestments: Record<string, unknown>[] = [],
  ) => {
    mockTradeDealRepo.findOne.mockResolvedValue(mockDeal as TradeDeal);
    mockInvestmentRepo.find.mockResolvedValue(mockInvestments as Investment[]);
  };

  beforeEach(async () => {
    jest.useFakeTimers();

    mockQueryRunnerManager = {
      create: jest.fn().mockImplementation((_entity, data) => data),
      save: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    };

    mockQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: mockQueryRunnerManager,
    };

    mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    } as any;

    mockPaymentDistributionRepo = {
      update: jest.fn(),
    } as any;

    mockTradeDealRepo = {
      findOne: jest.fn(),
    } as any;

    mockInvestmentRepo = {
      find: jest.fn(),
    } as any;

    mockUserRepo = {} as any;

    mockStellarService = {
      releaseEscrow: jest.fn(),
      decryptSecret: jest.fn(),
    } as any;

    mockQueueService = {
      emit: jest.fn(),
      enqueueDealCleanup: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockConfigService = {
      get: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscrowService,
        {
          provide: PinoLogger,
          useValue: {
            setContext: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(PaymentDistribution),
          useValue: mockPaymentDistributionRepo,
        },
        {
          provide: getRepositoryToken(TradeDeal),
          useValue: mockTradeDealRepo,
        },
        {
          provide: getRepositoryToken(Investment),
          useValue: mockInvestmentRepo,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepo,
        },
        {
          provide: StellarService,
          useValue: mockStellarService,
        },
        {
          provide: QueueService,
          useValue: mockQueueService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<EscrowService>(EscrowService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('processDealDelivered', () => {
    it('should successfully process escrow release and complete deal', async () => {
      const tradeDealId = 'deal-123';
      const payload = { tradeDealId };

      const mockDeal = {
        id: tradeDealId,
        status: 'delivered',
        totalValue: 10000,
        farmerId: 'farmer-123',
        traderId: 'trader-123',
        escrowSecretKey: 'escrow-secret',
        farmer: { walletAddress: 'farmer-wallet' },
        trader: { walletAddress: 'trader-wallet' },
      };

      const mockInvestments = [
        {
          id: 'inv-1',
          tradeDealId,
          investorId: 'investor-1',
          tokenAmount: 50,
          amountUsd: 5000,
          investor: { walletAddress: 'investor-1-wallet' },
        },
        {
          id: 'inv-2',
          tradeDealId,
          investorId: 'investor-2',
          tokenAmount: 50,
          amountUsd: 5000,
          investor: { walletAddress: 'investor-2-wallet' },
        },
      ];

      setupDealMocks(mockDeal, mockInvestments);
      mockConfigService.get.mockReturnValue('platform-wallet');
      mockStellarService.decryptSecret.mockReturnValue(
        'decrypted-escrow-secret',
      );
      mockStellarService.releaseEscrow.mockResolvedValue(['stellar-tx-123']);

      await service.processDealDelivered(payload);

      expect(mockTradeDealRepo.findOne).toHaveBeenCalledWith({
        where: { id: tradeDealId },
        relations: ['farmer', 'trader'],
      });
      expect(mockStellarService.decryptSecret).toHaveBeenCalledWith(
        'escrow-secret',
      );
      expect(mockStellarService.releaseEscrow).toHaveBeenCalledWith(
        'decrypted-escrow-secret',
        'farmer-wallet',
        [
          {
            walletAddress: 'investor-1-wallet',
            tokenAmount: 50,
            totalTokens: 100,
          },
          {
            walletAddress: 'investor-2-wallet',
            tokenAmount: 50,
            totalTokens: 100,
          },
        ],
        'platform-wallet',
        10000,
      );

      expect(mockQueryRunnerManager.save).toHaveBeenCalledWith(
        PaymentDistribution,
        expect.arrayContaining([
          expect.objectContaining({
            recipientType: 'investor',
            amountUsd: 4900,
            stellarTxId: 'stellar-tx-123',
          }),
          expect.objectContaining({
            recipientType: 'investor',
            amountUsd: 4900,
            stellarTxId: 'stellar-tx-123',
          }),
          expect.objectContaining({
            recipientType: 'platform',
            amountUsd: 200,
            stellarTxId: 'stellar-tx-123',
          }),
        ]),
      );

      expect(mockQueryRunnerManager.update).toHaveBeenCalledWith(
        TradeDeal,
        tradeDealId,
        expect.objectContaining({
          status: 'completed',
          appTraceId: expect.any(String),
        }),
      );
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('should handle Stellar failure and send admin alert', async () => {
      const tradeDealId = 'deal-123';
      const payload = { tradeDealId };

      const mockDeal = {
        id: tradeDealId,
        status: 'delivered',
        totalValue: 10000,
        farmerId: 'farmer-123',
        traderId: 'trader-123',
        escrowSecretKey: 'escrow-secret',
        farmer: { walletAddress: 'farmer-wallet' },
        trader: { walletAddress: 'trader-wallet' },
      };

      const mockInvestments = [
        {
          id: 'inv-1',
          tradeDealId,
          investorId: 'investor-1',
          tokenAmount: 100,
          amountUsd: 10000,
          investor: { walletAddress: 'investor-1-wallet' },
        },
      ];

      setupDealMocks(mockDeal, mockInvestments);
      mockConfigService.get.mockReturnValue('platform-wallet');
      mockStellarService.decryptSecret.mockReturnValue(
        'decrypted-escrow-secret',
      );

      const stellarError = new Error('Stellar network error');
      mockStellarService.releaseEscrow.mockRejectedValue(stellarError);

      await expect(service.processDealDelivered(payload)).rejects.toThrow(
        'Stellar network error',
      );

      expect(mockQueueService.emit).toHaveBeenCalledWith('admin.alert', {
        type: 'escrow_failure',
        dealId: tradeDealId,
        error: 'Stellar network error',
        timestamp: expect.any(String),
      });

      expect(mockPaymentDistributionRepo.update).toHaveBeenCalledWith(
        { tradeDealId },
        { status: 'failed' },
      );
      expect(mockDataSource.createQueryRunner).not.toHaveBeenCalled();
    });

    it('should skip processing if deal is not in delivered status', async () => {
      const tradeDealId = 'deal-123';
      const payload = { tradeDealId };

      setupDealMocks({
        id: tradeDealId,
        status: 'funded',
        totalValue: 10000,
        farmerId: 'farmer-123',
        traderId: 'trader-123',
        escrowSecretKey: 'escrow-secret',
        farmer: { walletAddress: 'farmer-wallet' },
        trader: { walletAddress: 'trader-wallet' },
      });

      await service.processDealDelivered(payload);

      expect(mockStellarService.releaseEscrow).not.toHaveBeenCalled();
      expect(mockQueryRunnerManager.save).not.toHaveBeenCalled();
      expect(mockQueryRunnerManager.update).not.toHaveBeenCalled();
    });
  });
});
