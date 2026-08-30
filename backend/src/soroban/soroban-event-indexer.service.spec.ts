/**
 * Soroban Event Indexer Service Unit + Integration Tests (#791)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { SorobanEventIndexer, ContractEvent } from './soroban-event-indexer.service';
import { TransactionLog, TxStatus } from '../stellar/entities/transaction-log.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { ProcessedSorobanEvent } from './entities/processed-soroban-event.entity';
import { QueueService } from '../queue/queue.service';
import { SorobanService } from './soroban.service';
import { AuditService } from '../audit/audit.service';

const FARM_CAMPAIGN_CONTRACT = 'C1111111111111111111111111111111111111111111111111111111111';

describe('SorobanEventIndexer', () => {
  let service: SorobanEventIndexer;
  let txLogRepo: any;
  let milestoneRepo: any;
  let dealRepo: any;
  let processedEventsRepo: any;
  let queueService: any;
  let configService: any;
  let sorobanService: any;
  let auditService: any;
  let logger: any;

  beforeEach(async () => {
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

    processedEventsRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockResolvedValue({}),
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ max: null }),
      }),
    };

    queueService = {
      emit: jest.fn(),
    };

    sorobanService = {
      getCampaignState: jest.fn().mockResolvedValue(null),
    };

    auditService = {
      logEvent: jest.fn().mockResolvedValue(null),
    };

    configService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
          STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
          STELLAR_NETWORK: 'testnet',
          SOROBAN_EVENT_INDEXING_ENABLED: 'true',
          SOROBAN_EVENT_POLLING_INTERVAL_MS: 10000,
          FARM_CAMPAIGN_CONTRACT,
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
        { provide: getRepositoryToken(ProcessedSorobanEvent), useValue: processedEventsRepo },
        { provide: QueueService, useValue: queueService },
        { provide: SorobanService, useValue: sorobanService },
        { provide: AuditService, useValue: auditService },
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
      // Pre-existing: this call passes only the message, no leading object
      // (logger.info(msg) not logger.info(obj, msg)) — fixed assertion to
      // match the real call shape rather than the code.
      expect(logger.info).toHaveBeenCalledWith('Initializing Soroban event indexer...');
    });

    it('should not initialize if event indexing is disabled', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'SOROBAN_EVENT_INDEXING_ENABLED') return 'false';
        return configService.get(key);
      });

      await service.onModuleInit();
      expect(logger.info).toHaveBeenCalledWith('Soroban event indexing is disabled');
    });

    it('resumes from the last persisted ledger instead of tip-minus-100 (#791)', async () => {
      processedEventsRepo.createQueryBuilder().getRawOne.mockResolvedValue({ max: 424242 });
      await service.onModuleInit();
      expect(service.getStatus().lastLedger).toBe(424242);
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

      const handleMethod = (service as any).handleMilestoneCompleted;
      await handleMethod.call(service, { dealId: 'deal-001', milestoneIndex: 0 }, txHash);

      expect(txLogRepo.update).toHaveBeenCalledWith(
        { txHash },
        { status: TxStatus.SUCCESS },
      );
      expect(milestoneRepo.findOne).toHaveBeenCalled();
      expect(queueService.emit).toHaveBeenCalledWith(
        'milestone.completed',
        expect.objectContaining({ dealId: 'deal-001', txHash }),
      );
    });
  });

  describe('handleStatusChanged (#791)', () => {
    it("resolves the deal by the contract's sorobanCampaignContractId, not a payload field", async () => {
      dealRepo.findOne.mockResolvedValue({ id: 'deal-001', sorobanCampaignContractId: FARM_CAMPAIGN_CONTRACT });

      const handleMethod = (service as any).handleStatusChanged;
      await handleMethod.call(service, ['status_changed', 'funded'], FARM_CAMPAIGN_CONTRACT, 'tx789', 1000);

      expect(dealRepo.findOne).toHaveBeenCalledWith({
        where: { sorobanCampaignContractId: FARM_CAMPAIGN_CONTRACT },
      });
      expect(dealRepo.update).toHaveBeenCalledWith({ id: 'deal-001' }, { status: 'funded' });
      expect(queueService.emit).toHaveBeenCalledWith(
        'deal.status.changed',
        expect.objectContaining({ dealId: 'deal-001', status: 'funded' }),
      );
    });

    it('skips (does not write) an unmapped on-chain status like "active"', async () => {
      const handleMethod = (service as any).handleStatusChanged;
      await handleMethod.call(service, ['status_changed', 'active'], FARM_CAMPAIGN_CONTRACT, 'tx1', 1);
      expect(dealRepo.update).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('skips when no deal matches the contract id', async () => {
      dealRepo.findOne.mockResolvedValue(null);
      const handleMethod = (service as any).handleStatusChanged;
      await handleMethod.call(service, ['status_changed', 'funded'], FARM_CAMPAIGN_CONTRACT, 'tx1', 1);
      expect(dealRepo.update).not.toHaveBeenCalled();
    });

    it('fires a discrepancy alert when the on-chain state disagrees with what was just written', async () => {
      dealRepo.findOne.mockResolvedValue({ id: 'deal-001', sorobanCampaignContractId: FARM_CAMPAIGN_CONTRACT });
      sorobanService.getCampaignState.mockResolvedValue({ status: 'Delivered' });

      const handleMethod = (service as any).handleStatusChanged;
      await handleMethod.call(service, ['status_changed', 'funded'], FARM_CAMPAIGN_CONTRACT, 'tx1', 1);

      expect(auditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          route: 'soroban-indexer:status-discrepancy',
          requestDetails: expect.objectContaining({
            dealId: 'deal-001',
            dbStatus: 'funded',
            chainStatus: 'delivered',
          }),
        }),
      );
    });

    it('does not fire a discrepancy alert when on-chain state agrees', async () => {
      dealRepo.findOne.mockResolvedValue({ id: 'deal-001', sorobanCampaignContractId: FARM_CAMPAIGN_CONTRACT });
      sorobanService.getCampaignState.mockResolvedValue({ status: 'Funded' });

      const handleMethod = (service as any).handleStatusChanged;
      await handleMethod.call(service, ['status_changed', 'funded'], FARM_CAMPAIGN_CONTRACT, 'tx1', 1);

      expect(auditService.logEvent).not.toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('should return indexer status', () => {
      const status = service.getStatus();
      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('lastLedger');
      expect(typeof status.isRunning).toBe('boolean');
      expect(typeof status.lastLedger).toBe('number');
    });
  });

  describe('full indexer -> DB flow (integration, #791)', () => {
    function statusChangedEvent(overrides: Partial<ContractEvent> = {}): ContractEvent {
      return {
        id: 'evt-001',
        txHash: 'tx999',
        ledger: 1000,
        contractId: FARM_CAMPAIGN_CONTRACT,
        type: 'status_changed',
        topic: ['status_changed', 'funded'],
        value: undefined,
        ...overrides,
      };
    }

    it('processes a decoded event end-to-end and syncs the deal status', async () => {
      dealRepo.findOne.mockResolvedValue({ id: 'deal-001', sorobanCampaignContractId: FARM_CAMPAIGN_CONTRACT });

      const processMethod = (service as any).processEvent;
      await processMethod.call(service, statusChangedEvent());

      expect(dealRepo.update).toHaveBeenCalledWith({ id: 'deal-001' }, { status: 'funded' });
      expect(processedEventsRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'evt-001', contractId: FARM_CAMPAIGN_CONTRACT, ledger: 1000 }),
      );
    });

    it('is idempotent: replaying the same event id does not duplicate the DB update', async () => {
      dealRepo.findOne.mockResolvedValue({ id: 'deal-001', sorobanCampaignContractId: FARM_CAMPAIGN_CONTRACT });

      const processMethod = (service as any).processEvent;
      const event = statusChangedEvent();

      await processMethod.call(service, event);
      // Simulate the persisted idempotency record now existing, exactly as
      // it would after the insert above on a real DB.
      processedEventsRepo.findOne.mockResolvedValue({ id: event.id });

      await processMethod.call(service, event);

      expect(dealRepo.update).toHaveBeenCalledTimes(1);
      expect(processedEventsRepo.insert).toHaveBeenCalledTimes(1);
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
