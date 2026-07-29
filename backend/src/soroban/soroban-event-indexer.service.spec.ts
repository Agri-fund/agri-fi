/**
 * Soroban Event Indexer Service Unit Tests
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { SorobanEventIndexer } from './soroban-event-indexer.service';
import { TransactionLog, TxStatus } from '../stellar/entities/transaction-log.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { QueueService } from '../queue/queue.service';

describe('SorobanEventIndexer', () => {
  let service: SorobanEventIndexer;
  let txLogRepo: any;
  let milestoneRepo: any;
  let dealRepo: any;
  let queueService: any;
  let configService: any;
  let logger: any;

  beforeEach(async () => {
    // Setup mocks
    txLogRepo = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn(),
      save: jest.fn(),
    };

    milestoneRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };

    dealRepo = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn(),
    };

    queueService = {
      emit: jest.fn(),
    };

    configService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
          STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
          STELLAR_NETWORK: 'testnet',
          SOROBAN_EVENT_INDEXING_ENABLED: 'true',
          SOROBAN_EVENT_POLLING_INTERVAL_MS: 10000,
          FARM_CAMPAIGN_CONTRACT: 'C1111111111111111111111111111111111111111111111111111111111',
          PROJECT_FACTORY_CONTRACT: 'C2222222222222222222222222222222222222222222222222222222222',
          REVENUE_DISTRIBUTOR_CONTRACT: 'C3333333333333333333333333333333333333333333333333333333333',
          MARKETPLACE_SETTLEMENT_CONTRACT: 'C4444444444444444444444444444444444444444444444444444444444',
        };
        return config[key] ?? defaultValue;
      }),
    };

    logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanEventIndexer,
        { provide: ConfigService, useValue: configService },
        { provide: PinoLogger, useValue: logger },
        { provide: getRepositoryToken(TransactionLog), useValue: txLogRepo },
        { provide: getRepositoryToken(ShipmentMilestone), useValue: milestoneRepo },
        { provide: getRepositoryToken(TradeDeal), useValue: dealRepo },
        { provide: QueueService, useValue: queueService },
      ],
    }).compile();

    service = module.get<SorobanEventIndexer>(SorobanEventIndexer);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('onModuleInit', () => {
    it('should initialize successfully', async () => {
      await service.onModuleInit();
      expect(logger.info).toHaveBeenCalledWith(
        expect.any(Object),
        'Initializing Soroban event indexer...',
      );
    });

    it('should not initialize if event indexing is disabled', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'SOROBAN_EVENT_INDEXING_ENABLED') return 'false';
        return configService.get(key);
      });

      await service.onModuleInit();
      expect(logger.info).toHaveBeenCalledWith('Soroban event indexing is disabled');
    });
  });

  describe('handleMilestoneCompleted', () => {
    it('should update transaction log and milestone with completion event', async () => {
      const txHash = 'tx123abc';
      const milestone = {
        id: 'ms-001',
        tradeDealId: 'deal-001',
        stellarTxId: null,
        save: jest.fn(),
      };

      milestoneRepo.findOne.mockResolvedValue(milestone);

      // Access private method for testing (not ideal but necessary)
      const handleMethod = (service as any).handleMilestoneCompleted;
      await handleMethod.call(service, { dealId: 'deal-001', milestoneIndex: 0 }, txHash);

      expect(txLogRepo.update).toHaveBeenCalledWith(
        { txHash },
        { status: TxStatus.SUCCESS },
      );

      expect(milestoneRepo.findOne).toHaveBeenCalled();
      expect(milestone.save).toHaveBeenCalled();

      expect(queueService.emit).toHaveBeenCalledWith(
        'milestone.completed',
        expect.objectContaining({
          dealId: 'deal-001',
          txHash,
        }),
      );
    });

    it('should handle missing milestone gracefully', async () => {
      milestoneRepo.findOne.mockResolvedValue(null);

      const handleMethod = (service as any).handleMilestoneCompleted;
      await expect(
        handleMethod.call(service, { dealId: 'deal-001' }, 'tx123'),
      ).resolves.not.toThrow();

      // Should still log but not crash
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe('handleFundingReceived', () => {
    it('should update transaction log and emit investment confirmed event', async () => {
      const handleMethod = (service as any).handleFundingReceived;
      const data = {
        dealId: 'deal-001',
        investorId: 'inv-001',
        amount: 1000000,
      };
      const txHash = 'tx456def';

      await handleMethod.call(service, data, txHash);

      expect(txLogRepo.update).toHaveBeenCalledWith(
        { txHash },
        {
          status: TxStatus.SUCCESS,
          dealId: 'deal-001',
          userId: 'inv-001',
        },
      );

      expect(queueService.emit).toHaveBeenCalledWith(
        'investment.confirmed',
        expect.objectContaining({
          dealId: 'deal-001',
          investorId: 'inv-001',
          amount: 1000000,
          txHash,
        }),
      );
    });
  });

  describe('handleCampaignStatusChanged', () => {
    it('should update deal status and emit event', async () => {
      const handleMethod = (service as any).handleCampaignStatusChanged;
      const data = {
        dealId: 'deal-001',
        newStatus: 'funded',
      };
      const txHash = 'tx789ghi';

      await handleMethod.call(service, data, txHash);

      expect(dealRepo.update).toHaveBeenCalledWith(
        { id: 'deal-001' },
        { status: 'funded' },
      );

      expect(queueService.emit).toHaveBeenCalledWith(
        'deal.status.changed',
        expect.objectContaining({
          dealId: 'deal-001',
          status: 'funded',
          txHash,
        }),
      );
    });
  });

  describe('getStatus', () => {
    it('should return indexer status', () => {
      const status = service.getStatus();

      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('lastLedger');
      expect(status).toHaveProperty('processedEventsCount');
      expect(typeof status.isRunning).toBe('boolean');
      expect(typeof status.lastLedger).toBe('number');
      expect(typeof status.processedEventsCount).toBe('number');
    });
  });

  describe('Event deduplication', () => {
    it('should not process duplicate events', async () => {
      const event = {
        id: 'evt-001',
        transactionHash: 'tx999',
        ledger: 1000,
        contractId: 'C1111111111111111111111111111111111111111111111111111111111',
        type: 'milestone_completed',
        topic: [],
        value: { dealId: 'deal-001', milestoneIndex: 0 },
      };

      // Process event twice
      const processMethod = (service as any).processEvent;
      
      txLogRepo.update.mockResolvedValue({ affected: 1 });
      milestoneRepo.findOne.mockResolvedValue({ id: 'ms-001', save: jest.fn() });

      await processMethod.call(service, event);
      await processMethod.call(service, event);

      // Should only process once (cache prevents duplicate)
      expect(txLogRepo.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error handling', () => {
    it('should log errors without throwing', async () => {
      const handleMethod = (service as any).handleMilestoneCompleted;
      txLogRepo.update.mockRejectedValue(new Error('DB error'));

      await expect(
        handleMethod.call(service, { dealId: 'deal-001' }, 'tx123'),
      ).resolves.not.toThrow();

      expect(logger.error).toHaveBeenCalled();
    });
  });
});
