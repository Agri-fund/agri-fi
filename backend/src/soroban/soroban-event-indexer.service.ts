/**
 * Soroban Event Indexing Service
 *
 * Subscribes to Soroban smart contract event topics and syncs on-chain state
 * changes to the local database in real-time.
 *
 * Features:
 * - Polls Horizon API for contract events
 * - Tracks processed events to avoid duplicates
 * - Updates database records based on contract events
 * - Handles retries and error recovery
 * - Emits internal events for downstream processing
 */

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { Repository } from 'typeorm';
import { Horizon, Networks, rpc } from '@stellar/stellar-sdk';
import {
  TransactionLog,
  TxStatus,
} from '../stellar/entities/transaction-log.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { QueueService } from '../queue/queue.service';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';

/**
 * Represents a processed event to prevent duplicate processing
 */
export interface ProcessedEvent {
  eventId: string;
  transactionHash: string;
  contractId: string;
  eventType: string;
  processedAt: Date;
}

/**
 * Represents a contract event structure
 */
export interface ContractEvent {
  id: string;
  transactionHash: string;
  ledger: number;
  contractId: string;
  type: string;
  topic: string[];
  value: Record<string, unknown>;
}

@Injectable()
export class SorobanEventIndexer implements OnModuleInit, OnModuleDestroy {
  private readonly rpcServer: rpc.Server;
  private readonly horizonServer: Horizon.Server;
  private readonly networkPassphrase: string;
  private pollingInterval: NodeJS.Timer | null = null;
  private lastLedger: number = 0;
  private readonly processedEventsCache = new Map<string, ProcessedEvent>();
  private isRunning = false;

  // Contract addresses (should be in config)
  private readonly contractAddresses = {
    farmCampaign: process.env.FARM_CAMPAIGN_CONTRACT || '',
    projectFactory: process.env.PROJECT_FACTORY_CONTRACT || '',
    revenueDistributor: process.env.REVENUE_DISTRIBUTOR_CONTRACT || '',
    marketplaceSettlement: process.env.MARKETPLACE_SETTLEMENT_CONTRACT || '',
  };

  constructor(
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
    @InjectRepository(TransactionLog)
    private readonly txLogRepo: Repository<TransactionLog>,
    @InjectRepository(ShipmentMilestone)
    private readonly milestoneRepo: Repository<ShipmentMilestone>,
    @InjectRepository(TradeDeal)
    private readonly dealRepo: Repository<TradeDeal>,
    private readonly queueService: QueueService,
  ) {
    (this.logger as any).setContext(SorobanEventIndexer.name);

    const rpcUrl = config.get<string>(
      'SOROBAN_RPC_URL',
      'https://soroban-testnet.stellar.org',
    );
    const horizonUrl = config.get<string>(
      'STELLAR_HORIZON_URL',
      'https://horizon-testnet.stellar.org',
    );
    const network = config.get<string>('STELLAR_NETWORK', 'testnet');

    this.rpcServer = new rpc.Server(rpcUrl, { allowHttp: false });
    this.horizonServer = new Horizon.Server(horizonUrl);
    this.networkPassphrase =
      network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
  }

  /**
   * Initialize event indexing on module startup
   */
  async onModuleInit() {
    const indexingEnabled = this.config.get<string>(
      'SOROBAN_EVENT_INDEXING_ENABLED',
      'true',
    );

    if (indexingEnabled === 'false') {
      this.logger.info('Soroban event indexing is disabled');
      return;
    }

    this.logger.info('Initializing Soroban event indexer...');
    try {
      await this.initializeLastLedger();
      this.startPolling();
      this.logger.info('✓ Soroban event indexer initialized');
    } catch (error) {
      this.logger.error(
        { error },
        'Failed to initialize Soroban event indexer',
      );
      // Don't throw - allow app to start even if indexer fails
    }
  }

  /**
   * Clean up resources on module destroy
   */
  onModuleDestroy() {
    this.stopPolling();
  }

  /**
   * Initialize the last ledger to start polling from
   */
  private async initializeLastLedger() {
    try {
      const ledger = await this.horizonServer
        .ledgers()
        .limit(1)
        .order('desc')
        .call();
      if (ledger.records && ledger.records.length > 0) {
        this.lastLedger = ledger.records[0].sequence - 100; // Start 100 ledgers behind
        this.logger.info(
          { ledger: this.lastLedger },
          'Event indexing started from ledger',
        );
      }
    } catch (error) {
      this.logger.warn(
        { error },
        'Could not fetch latest ledger, starting from 0',
      );
      this.lastLedger = 0;
    }
  }

  /**
   * Start the polling interval for events
   */
  private startPolling() {
    if (this.pollingInterval) {
      return;
    }

    const intervalMs = this.config.get<number>(
      'SOROBAN_EVENT_POLLING_INTERVAL_MS',
      10000, // 10 seconds
    );

    this.isRunning = true;
    this.pollingInterval = setInterval(() => {
      this.pollForEvents().catch((error) => {
        this.logger.error({ error }, 'Event polling error');
      });
    }, intervalMs);

    this.logger.info({ intervalMs }, 'Soroban event polling started');
  }

  /**
   * Stop the polling interval
   */
  private stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      this.isRunning = false;
      this.logger.info('Soroban event polling stopped');
    }
  }

  /**
   * Poll for new events from the Soroban RPC
   */
  private async pollForEvents() {
    if (!this.isRunning || this.lastLedger === 0) {
      return;
    }

    try {
      // Query events from RPC
      const events = await this.queryEvents();

      if (events.length === 0) {
        return;
      }

      this.logger.debug(
        { eventCount: events.length },
        'Retrieved events from RPC',
      );

      // Process each event
      for (const event of events) {
        await this.processEvent(event);
      }

      // Update last ledger
      if (events.length > 0) {
        const maxLedger = Math.max(...events.map((e) => e.ledger));
        this.lastLedger = maxLedger;
      }
    } catch (error) {
      this.logger.error({ error }, 'Error during event polling');
    }
  }

  /**
   * Query events from Soroban RPC
   */
  private async queryEvents(): Promise<ContractEvent[]> {
    try {
      // Query for contract events using the RPC getEvents method
      const eventsResponse = await (this.rpcServer as any).getEvents({
        startLedger: this.lastLedger,
        filters: this.buildEventFilters(),
        limit: 100,
      });

      if (!eventsResponse || !eventsResponse.events) {
        return [];
      }

      return eventsResponse.events.map((event: any): ContractEvent => ({
        id: `${event.id}`,
        transactionHash: event.transactionHash,
        ledger: event.ledger,
        contractId: event.contractId,
        type: event.type,
        topic: event.topic || [],
        value: event.value || {},
      }));
    } catch (error) {
      this.logger.debug({ error }, 'Error querying events from RPC');
      return [];
    }
  }

  /**
   * Build event filters for RPC query
   */
  private buildEventFilters() {
    const filters = [];

    // Filter for contract events from known contracts
    for (const [contractName, contractId] of Object.entries(
      this.contractAddresses,
    )) {
      if (contractId) {
        filters.push({
          contractIds: [contractId],
          type: 'contract',
        });
      }
    }

    return filters.length > 0 ? filters : undefined;
  }

  /**
   * Process a single contract event
   */
  private async processEvent(event: ContractEvent) {
    // Check if already processed
    const eventKey = `${event.transactionHash}-${event.contractId}-${event.type}`;
    if (this.processedEventsCache.has(eventKey)) {
      return;
    }

    try {
      // Route to appropriate handler based on contract and event type
      if (event.contractId === this.contractAddresses.farmCampaign) {
        await this.handleFarmCampaignEvent(event);
      } else if (
        event.contractId === this.contractAddresses.marketplaceSettlement
      ) {
        await this.handleMarketplaceSettlementEvent(event);
      } else if (
        event.contractId === this.contractAddresses.revenueDistributor
      ) {
        await this.handleRevenueDistributorEvent(event);
      }

      // Mark as processed
      this.processedEventsCache.set(eventKey, {
        eventId: event.id,
        transactionHash: event.transactionHash,
        contractId: event.contractId,
        eventType: event.type,
        processedAt: new Date(),
      });

      // Clean up old cache entries (keep last 1000)
      if (this.processedEventsCache.size > 1000) {
        const firstKey = this.processedEventsCache.keys().next().value;
        this.processedEventsCache.delete(firstKey);
      }

      this.logger.debug(
        { transactionHash: event.transactionHash, eventType: event.type },
        'Event processed successfully',
      );
    } catch (error) {
      this.logger.warn(
        { error, transactionHash: event.transactionHash },
        'Error processing event',
      );
    }
  }

  /**
   * Handle FarmCampaign contract events
   */
  private async handleFarmCampaignEvent(event: ContractEvent) {
    const { type, value, transactionHash } = event;

    switch (type) {
      case 'milestone_completed':
        await this.handleMilestoneCompleted(value as any, transactionHash);
        break;

      case 'funding_received':
        await this.handleFundingReceived(value as any, transactionHash);
        break;

      case 'campaign_status_changed':
        await this.handleCampaignStatusChanged(value as any, transactionHash);
        break;

      default:
        this.logger.debug({ eventType: type }, 'Unknown event type');
    }
  }

  /**
   * Handle MarketplaceSettlement contract events
   */
  private async handleMarketplaceSettlementEvent(event: ContractEvent) {
    const { type, value, transactionHash } = event;

    switch (type) {
      case 'settlement_completed':
        await this.handleSettlementCompleted(value as any, transactionHash);
        break;

      case 'trade_settled':
        await this.handleTradeSettled(value as any, transactionHash);
        break;

      default:
        this.logger.debug({ eventType: type }, 'Unknown settlement event');
    }
  }

  /**
   * Handle RevenueDistributor contract events
   */
  private async handleRevenueDistributorEvent(event: ContractEvent) {
    const { type, value, transactionHash } = event;

    switch (type) {
      case 'revenue_distributed':
        await this.handleRevenueDistributed(value as any, transactionHash);
        break;

      default:
        this.logger.debug({ eventType: type }, 'Unknown revenue event');
    }
  }

  /**
   * Handle milestone completion event
   */
  private async handleMilestoneCompleted(data: any, txHash: string) {
    try {
      const { dealId, milestoneIndex } = data;

      // Update transaction log
      await this.txLogRepo.update(
        { txHash },
        {
          status: TxStatus.SUCCESS,
        },
      );

      // Find and update the corresponding milestone
      const milestone = await this.milestoneRepo.findOne({
        where: {
          tradeDealId: dealId,
        },
      });

      if (milestone) {
        milestone.stellarTxId = txHash;
        await this.milestoneRepo.save(milestone);

        this.logger.info(
          { dealId, milestoneIndex, txHash },
          'Milestone marked as completed on-chain',
        );

        // Emit event for downstream processing
        this.queueService.emit('milestone.completed', {
          dealId,
          milestoneIndex,
          txHash,
          timestamp: new Date(),
        });
      }
    } catch (error) {
      this.logger.error(
        { error, txHash },
        'Error handling milestone_completed event',
      );
    }
  }

  /**
   * Handle funding received event
   */
  private async handleFundingReceived(data: any, txHash: string) {
    try {
      const { dealId, investorId, amount } = data;

      // Update transaction log
      await this.txLogRepo.update(
        { txHash },
        {
          status: TxStatus.SUCCESS,
          dealId,
          userId: investorId,
        },
      );

      // Emit event for downstream processing
      this.queueService.emit('investment.confirmed', {
        dealId,
        investorId,
        amount,
        txHash,
        timestamp: new Date(),
      });

      this.logger.info(
        { dealId, investorId, amount, txHash },
        'Funding received on-chain',
      );
    } catch (error) {
      this.logger.error(
        { error, txHash },
        'Error handling funding_received event',
      );
    }
  }

  /**
   * Handle campaign status change event
   */
  private async handleCampaignStatusChanged(data: any, txHash: string) {
    try {
      const { dealId, newStatus } = data;

      // Update deal status
      await this.dealRepo.update(
        { id: dealId },
        {
          status: newStatus,
        },
      );

      this.logger.info(
        { dealId, newStatus, txHash },
        'Campaign status changed on-chain',
      );

      // Emit event
      this.queueService.emit('deal.status.changed', {
        dealId,
        status: newStatus,
        txHash,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error(
        { error, txHash },
        'Error handling campaign_status_changed event',
      );
    }
  }

  /**
   * Handle settlement completed event
   */
  private async handleSettlementCompleted(data: any, txHash: string) {
    try {
      const { dealId, settlementAmount } = data;

      this.logger.info(
        { dealId, settlementAmount, txHash },
        'Settlement completed on-chain',
      );

      // Emit event
      this.queueService.emit('settlement.completed', {
        dealId,
        settlementAmount,
        txHash,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error(
        { error, txHash },
        'Error handling settlement_completed event',
      );
    }
  }

  /**
   * Handle trade settled event
   */
  private async handleTradeSettled(data: any, txHash: string) {
    try {
      const { dealId } = data;

      this.logger.info({ dealId, txHash }, 'Trade settled on-chain');

      // Emit event
      this.queueService.emit('trade.settled', {
        dealId,
        txHash,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error(
        { error, txHash },
        'Error handling trade_settled event',
      );
    }
  }

  /**
   * Handle revenue distributed event
   */
  private async handleRevenueDistributed(data: any, txHash: string) {
    try {
      const { dealId, amount, distributionCount } = data;

      this.logger.info(
        { dealId, amount, distributionCount, txHash },
        'Revenue distributed on-chain',
      );

      // Emit event
      this.queueService.emit('revenue.distributed', {
        dealId,
        amount,
        distributionCount,
        txHash,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.error(
        { error, txHash },
        'Error handling revenue_distributed event',
      );
    }
  }

  /**
   * Get current indexer status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastLedger: this.lastLedger,
      processedEventsCount: this.processedEventsCache.size,
    };
  }

  /**
   * Manual trigger to poll events once
   */
  async pollOnce() {
    await this.pollForEvents();
  }
}
