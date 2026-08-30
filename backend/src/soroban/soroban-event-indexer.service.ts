/**
 * Soroban Event Indexing Service
 *
 * Subscribes to Soroban smart contract event topics and syncs on-chain state
 * changes to the local database in real-time.
 *
 * Features:
 * - Polls the Soroban RPC for contract events
 * - Tracks processed events (persisted — see ProcessedSorobanEvent) to avoid
 *   duplicate processing across restarts
 * - Updates database records based on contract events
 * - Cross-checks the applied state against the contract's own on-chain
 *   state and raises a discrepancy alert on mismatch (#791)
 * - Emits internal events for downstream processing
 */

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { Repository } from 'typeorm';
import { Horizon, Networks, rpc, scValToNative } from '@stellar/stellar-sdk';
import { TransactionLog, TxStatus } from '../stellar/entities/transaction-log.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { QueueService } from '../queue/queue.service';
import { TradeDeal, TradeDealStatus } from '../trade-deals/entities/trade-deal.entity';
import { ProcessedSorobanEvent } from './entities/processed-soroban-event.entity';
import { SorobanService } from './soroban.service';
import { AuditService } from '../audit/audit.service';

/**
 * A contract event, already decoded from XDR into native JS values by the
 * time it reaches processEvent/handlers — `topic`/`value` are native, not
 * ScVal. `type` is the decoded first topic (the event's own name, e.g.
 * "status_changed"), not an RPC field — the RPC's own `type` field is just
 * 'contract' | 'system' | 'diagnostic' and was never a business event name.
 */
export interface ContractEvent {
  id: string;
  txHash: string;
  ledger: number;
  contractId: string;
  type: string;
  topic: unknown[];
  value: unknown;
}

/**
 * FarmCampaign's on-chain CampaignStatus values (the second topic on a
 * "status_changed" event, e.g. symbol_short!("funded")) mapped to this
 * backend's TradeDealStatus. "active" and "paused" have no direct
 * TradeDealStatus equivalent today — logged and skipped rather than guessed,
 * so a bad guess never corrupts deal state.
 */
const CAMPAIGN_STATUS_TO_DEAL_STATUS: Partial<Record<string, TradeDealStatus>> = {
  open: 'open',
  funded: 'funded',
  delivered: 'delivered',
  completed: 'completed',
  failed: 'failed',
};

@Injectable()
export class SorobanEventIndexer implements OnModuleInit, OnModuleDestroy {
  private readonly rpcServer: rpc.Server;
  private readonly horizonServer: Horizon.Server;
  private readonly networkPassphrase: string;
  private pollingInterval: NodeJS.Timer | null = null;
  private lastLedger: number = 0;
  private isRunning = false;

  // Contract addresses. Read via the injected ConfigService (not
  // process.env directly, #791) so this class is actually testable with a
  // mocked ConfigService — a prior version read process.env at class-field
  // init time, which always evaluated to '' under jest, silently defeating
  // the contract-id matching in processEvent for any test that exercised it.
  private readonly contractAddresses: {
    farmCampaign: string;
    projectFactory: string;
    revenueDistributor: string;
    marketplaceSettlement: string;
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
    @InjectRepository(ProcessedSorobanEvent)
    private readonly processedEventsRepo: Repository<ProcessedSorobanEvent>,
    private readonly queueService: QueueService,
    private readonly sorobanService: SorobanService,
    private readonly auditService: AuditService,
  ) {
    this.logger.setContext(SorobanEventIndexer.name);

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

    this.contractAddresses = {
      farmCampaign: config.get<string>('FARM_CAMPAIGN_CONTRACT', ''),
      projectFactory: config.get<string>('PROJECT_FACTORY_CONTRACT', ''),
      revenueDistributor: config.get<string>('REVENUE_DISTRIBUTOR_CONTRACT', ''),
      marketplaceSettlement: config.get<string>('MARKETPLACE_SETTLEMENT_CONTRACT', ''),
    };
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
   * Initialize the last ledger to start polling from (#791).
   *
   * Resumes from the highest ledger of any event we've already persisted to
   * processed_soroban_events, so a restart doesn't reprocess recent events
   * or (worse) silently skip everything older than 100 ledgers back. Only
   * falls back to "current tip minus 100" on a genuinely fresh deployment
   * with no processed-event history yet.
   */
  private async initializeLastLedger() {
    try {
      const { max } = await this.processedEventsRepo
        .createQueryBuilder('e')
        .select('MAX(e.ledger)', 'max')
        .getRawOne<{ max: number | string | null }>();
      if (max !== null && max !== undefined) {
        this.lastLedger = Number(max);
        this.logger.info(
          { ledger: this.lastLedger },
          'Resuming event indexing from last processed ledger',
        );
        return;
      }
    } catch (error) {
      this.logger.warn({ error }, 'Could not read last processed ledger from DB');
    }

    try {
      const ledger = await this.horizonServer.ledgers().limit(1).order('desc').call();
      if (ledger.records && ledger.records.length > 0) {
        this.lastLedger = ledger.records[0].sequence - 100; // Start 100 ledgers behind
        this.logger.info({ ledger: this.lastLedger }, 'Event indexing started from ledger');
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

    this.logger.info(
      { intervalMs },
      'Soroban event polling started',
    );
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
   * Query events from the Soroban RPC and decode their XDR topics/value
   * into native JS values (#791). `getEvents` already returns `topic` as
   * `xdr.ScVal[]` and `value` as `xdr.ScVal` (not raw base64), so
   * `scValToNative` is all that's needed — no manual XDR parsing.
   */
  private async queryEvents(): Promise<ContractEvent[]> {
    try {
      const eventsResponse = await this.rpcServer.getEvents({
        startLedger: this.lastLedger,
        filters: this.buildEventFilters(),
        limit: 100,
      });

      if (!eventsResponse || !eventsResponse.events) {
        return [];
      }

      return eventsResponse.events.map((event): ContractEvent => {
        const topic = (event.topic ?? []).map((t) => scValToNative(t));
        return {
          id: `${event.id}`,
          txHash: event.txHash,
          ledger: event.ledger,
          contractId: event.contractId?.contractId() ?? '',
          // The event's own name is its first topic (e.g. "status_changed"),
          // not the RPC's `type` field (which is just 'contract'/'system'/
          // 'diagnostic' and was never a business event name).
          type: typeof topic[0] === 'string' ? topic[0] : '',
          topic,
          value: event.value ? scValToNative(event.value) : undefined,
        };
      });
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
          type: 'contract' as const,
        });
      }
    }

    return filters.length > 0 ? filters : undefined;
  }

  /**
   * Process a single contract event, idempotently (#791).
   *
   * Idempotency is now a persisted check (processed_soroban_events, keyed
   * by the RPC's own globally-unique event id) instead of an in-process
   * Map, so replaying events after a restart does not reprocess them — the
   * in-memory version was empty again on every restart.
   */
  private async processEvent(event: ContractEvent) {
    const alreadyProcessed = await this.processedEventsRepo.findOne({
      where: { id: event.id },
    });
    if (alreadyProcessed) {
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

      // Mark as processed — after a successful handler run, so a failed
      // handler can be retried on the next poll instead of being silently
      // skipped forever.
      await this.processedEventsRepo
        .insert({
          id: event.id,
          contractId: event.contractId,
          transactionHash: event.txHash,
          ledger: event.ledger,
          eventType: event.type,
        })
        .catch((err) => {
          // Duplicate key = another poll already recorded this event
          // concurrently; the work is done either way, nothing to retry.
          this.logger.debug({ err, eventId: event.id }, 'processed_soroban_events insert skipped');
        });

      this.logger.debug(
        { txHash: event.txHash, eventType: event.type },
        'Event processed successfully',
      );
    } catch (error) {
      this.logger.warn(
        { error, txHash: event.txHash },
        'Error processing event',
      );
    }
  }

  /**
   * Handle FarmCampaign contract events.
   *
   * Only "status_changed" (the deal-status-sync event, #791) is actually
   * wired up to real on-chain topic names below. "milestone_completed" and
   * "funding_received" never corresponded to any topic this contract
   * actually emits (the real topics are "milestone" and "invested" with a
   * different payload shape) — left as unreached cases rather than removed,
   * flagged here for whoever picks up milestone/funding sync as a follow-up.
   */
  private async handleFarmCampaignEvent(event: ContractEvent) {
    const { type, topic, txHash, ledger, contractId } = event;

    switch (type) {
      case 'status_changed':
        await this.handleStatusChanged(topic, contractId, txHash, ledger);
        break;

      // Not real on-chain topic names — see method doc comment above.
      case 'milestone_completed':
        await this.handleMilestoneCompleted(event.value as any, txHash);
        break;
      case 'funding_received':
        await this.handleFundingReceived(event.value as any, txHash);
        break;

      default:
        this.logger.debug({ eventType: type }, 'Unhandled FarmCampaign event type');
    }
  }

  /**
   * Handle MarketplaceSettlement contract events
   */
  private async handleMarketplaceSettlementEvent(event: ContractEvent) {
    const { type, value, txHash } = event;

    switch (type) {
      case 'settlement_completed':
        await this.handleSettlementCompleted(value as any, txHash);
        break;

      case 'trade_settled':
        await this.handleTradeSettled(value as any, txHash);
        break;

      default:
        this.logger.debug({ eventType: type }, 'Unknown settlement event');
    }
  }

  /**
   * Handle RevenueDistributor contract events
   */
  private async handleRevenueDistributorEvent(event: ContractEvent) {
    const { type, value, txHash } = event;

    switch (type) {
      case 'revenue_distributed':
        await this.handleRevenueDistributed(value as any, txHash);
        break;

      default:
        this.logger.debug({ eventType: type }, 'Unknown revenue event');
    }
  }

  /**
   * Handle a FarmCampaign "status_changed" event — the on-chain signal this
   * backend calls "deal status changed" (#791; there is no event literally
   * named "DealStatusChanged" on-chain — this is it).
   *
   * The event carries no dealId field at all: farm_campaign contracts are
   * deployed one-per-deal, so the deal is identified by *which contract*
   * emitted the event (`contractId`), matched against
   * `TradeDeal.sorobanCampaignContractId` — not by a payload field.
   */
  private async handleStatusChanged(
    topic: unknown[],
    contractId: string,
    txHash: string,
    ledger: number,
  ) {
    const rawStatus = topic[1];
    const newStatus =
      typeof rawStatus === 'string'
        ? CAMPAIGN_STATUS_TO_DEAL_STATUS[rawStatus.toLowerCase()]
        : undefined;

    if (!newStatus) {
      this.logger.warn(
        { contractId, rawStatus, txHash },
        'status_changed event with unmapped/unknown campaign status — skipped',
      );
      return;
    }

    const deal = await this.dealRepo.findOne({
      where: { sorobanCampaignContractId: contractId },
    });
    if (!deal) {
      this.logger.warn(
        { contractId, newStatus, txHash },
        'status_changed event for a contract with no matching trade deal — skipped',
      );
      return;
    }

    await this.dealRepo.update({ id: deal.id }, { status: newStatus });

    this.logger.info(
      { dealId: deal.id, contractId, newStatus, txHash, ledger },
      'Deal status synced from on-chain event',
    );

    this.queueService.emit('deal.status.changed', {
      dealId: deal.id,
      status: newStatus,
      txHash,
      timestamp: new Date(),
    });

    await this.checkStatusDiscrepancy(deal.id, contractId, newStatus);
  }

  /**
   * Cross-checks the DB status we just wrote against the contract's own
   * on-chain state and raises a discrepancy alert if they disagree (#791).
   * Best-effort: any failure here is logged and swallowed rather than
   * failing the sync itself, which has already succeeded by this point.
   */
  private async checkStatusDiscrepancy(
    dealId: string,
    contractId: string,
    dbStatus: TradeDealStatus,
  ): Promise<void> {
    try {
      const state = (await this.sorobanService.getCampaignState(contractId)) as
        | { status?: unknown }
        | null;
      const chainStatusRaw = state?.status;
      // scValToNative decodes a unit-variant contract enum either as a bare
      // string or as { tag: 'Funded', values: [] } depending on SDK
      // version — handle both.
      const chainStatusTag =
        typeof chainStatusRaw === 'string'
          ? chainStatusRaw
          : (chainStatusRaw as { tag?: string } | undefined)?.tag;
      if (!chainStatusTag) return;

      const chainStatusMapped = CAMPAIGN_STATUS_TO_DEAL_STATUS[chainStatusTag.toLowerCase()];
      if (chainStatusMapped && chainStatusMapped !== dbStatus) {
        this.logger.error(
          { dealId, contractId, dbStatus, chainStatus: chainStatusMapped },
          'Deal status discrepancy detected between DB and on-chain state',
        );
        await this.auditService.logEvent({
          actorId: null,
          actorRole: 'soroban-event-indexer',
          route: 'soroban-indexer:status-discrepancy',
          statusCode: 500,
          requestDetails: { dealId, contractId, dbStatus, chainStatus: chainStatusMapped },
        });
      }
    } catch (error) {
      this.logger.debug(
        { error, dealId, contractId },
        'Could not cross-check deal status against on-chain state',
      );
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
      this.logger.error({ error, txHash }, 'Error handling trade_settled event');
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
    };
  }

  /**
   * Manual trigger to poll events once
   */
  async pollOnce() {
    await this.pollForEvents();
  }
}
