import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { EscrowService } from './escrow.service';
import { PaymentDistribution } from './entities/payment-distribution.entity';
import { TradeDeal } from '../users/entities/trade-deal.entity';
import { Investment } from '../users/entities/investment.entity';
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

  beforeEach(async () => {
    const mockManager = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };

    mockDataSource = {
      transaction: jest
        .fn()
        .mockImplementation((cb: (m: typeof mockManager) => Promise<unknown>) =>
          cb(mockManager),
        ),
    } as any;

    mockPaymentDistributionRepo = {
      update: jest.fn(),
    } as any;

    mockTradeDealRepo = {} as any;
    mockInvestmentRepo = {} as any;
    mockUserRepo = {} as any;

    mockStellarService = {
      releaseEscrow: jest.fn(),
      decryptSecret: jest.fn(),
    } as any;

    mockQueueService = {
      emit: jest.fn(),
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

      const mockManager = {
        findOne: jest.fn().mockResolvedValue(mockDeal),
        find: jest.fn().mockResolvedValue(mockInvestments),
        create: jest.fn().mockImplementation((entity, data) => data),
        save: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
      };

      (mockDataSource.transaction as jest.Mock).mockImplementation(
        (cb: (m: typeof mockManager) => Promise<unknown>) => cb(mockManager),
      );
      mockConfigService.get.mockReturnValue('platform-wallet');
      mockStellarService.decryptSecret.mockReturnValue('decrypted-escrow-secret');
      mockStellarService.releaseEscrow.mockResolvedValue(['stellar-tx-123']);

      await service.processDealDelivered(payload);

      // Verify Stellar secret was decrypted
      expect(mockStellarService.decryptSecret).toHaveBeenCalledWith(
        'escrow-secret',
      );

      // Verify Stellar escrow release was called with decrypted secret
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

      // Verify payment distributions were created (3 total: farmer, 2 investors, platform)
      expect(mockManager.save).toHaveBeenCalledWith(
        PaymentDistribution,
        expect.arrayContaining([
          expect.objectContaining({
            recipientType: 'farmer',
            amountUsd: 9800, // 98% of 10000
            stellarTxId: 'stellar-tx-123',
          }),
          expect.objectContaining({
            recipientType: 'investor',
            amountUsd: 5000, // 50% of 10000
            stellarTxId: 'stellar-tx-123',
          }),
          expect.objectContaining({
            recipientType: 'investor',
            amountUsd: 5000, // 50% of 10000
            stellarTxId: 'stellar-tx-123',
          }),
          expect.objectContaining({
            recipientType: 'platform',
            amountUsd: 200, // 2% of 10000
            stellarTxId: 'stellar-tx-123',
          }),
        ]),
      );

      // Verify deal status was updated to completed
      expect(mockManager.update).toHaveBeenCalledWith(TradeDeal, tradeDealId, {
        status: 'completed',
      });
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

      const mockManager = {
        findOne: jest.fn().mockResolvedValue(mockDeal),
        find: jest.fn().mockResolvedValue(mockInvestments),
        create: jest.fn(),
        save: jest.fn(),
        update: jest.fn(),
      };

      (mockDataSource.transaction as jest.Mock).mockImplementation(
        (cb: (m: typeof mockManager) => Promise<unknown>) => cb(mockManager),
      );
      mockConfigService.get.mockReturnValue('platform-wallet');

      // Simulate Stellar failure
      const stellarError = new Error('Stellar network error');
      mockStellarService.releaseEscrow.mockRejectedValue(stellarError);

      await expect(service.processDealDelivered(payload)).rejects.toThrow(
        'Stellar network error',
      );

      // Verify admin alert was sent
      expect(mockQueueService.emit).toHaveBeenCalledWith('admin.alert', {
        type: 'escrow_failure',
        dealId: tradeDealId,
        error: 'Stellar network error',
        timestamp: expect.any(String),
      });

      // Verify payment distributions were marked as failed
      expect(mockPaymentDistributionRepo.update).toHaveBeenCalledWith(
        { tradeDealId },
        { status: 'failed' },
      );
    });

    it('should skip processing if deal is not in delivered status', async () => {
      const tradeDealId = 'deal-123';
      const payload = { tradeDealId };

      const mockDeal = {
        id: tradeDealId,
        status: 'funded', // Not delivered
        totalValue: 10000,
        farmerId: 'farmer-123',
        traderId: 'trader-123',
        escrowSecretKey: 'escrow-secret',
        farmer: { walletAddress: 'farmer-wallet' },
        trader: { walletAddress: 'trader-wallet' },
      };

      const mockManager = {
        findOne: jest.fn().mockResolvedValue(mockDeal),
        find: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
        update: jest.fn(),
      };

      (mockDataSource.transaction as jest.Mock).mockImplementation(
        (cb: (m: typeof mockManager) => Promise<unknown>) => cb(mockManager),
      );

      await service.processDealDelivered(payload);

      // Verify no Stellar operations were performed
      expect(mockStellarService.releaseEscrow).not.toHaveBeenCalled();
      expect(mockManager.save).not.toHaveBeenCalled();
      expect(mockManager.update).not.toHaveBeenCalled();
    });
  });
});
