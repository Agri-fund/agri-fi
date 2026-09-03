import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { EntityManager } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { ClsService } from 'nestjs-cls';
import { QUEUE_SERVICE } from './queue.constants';
import { encryptPayload } from './queue.crypto';
import { OutboxService } from '../outbox/outbox.service';

export interface BasePayload {
  correlationId?: string;
}

export interface TransactionalQueueService {
  enqueueDealPublishTransactional(
    entityManager: EntityManager,
    payload: Omit<DealPublishPayload, 'correlationId'>,
  ): Promise<void>;

  enqueueDealDeliveredTransactional(
    entityManager: EntityManager,
    tradeDealId: string,
  ): Promise<void>;

  enqueueDealCleanupTransactional(
    entityManager: EntityManager,
    tradeDealId: string,
  ): Promise<void>;

  enqueueInvestmentFundTransactional(
    entityManager: EntityManager,
    payload: Omit<InvestmentFundPayload, 'correlationId'>,
  ): Promise<void>;

  enqueueDealFundedTransactional(
    entityManager: EntityManager,
    payload: Omit<DealFundedPayload, 'correlationId'>,
  ): Promise<void>;
}

export interface InvestmentFundPayload extends BasePayload {
  investmentId: string;
  signedXdr: string;
  escrowPublicKey: string;
  encryptedEscrowSecret: string;
  assetCode: string;
  tokenAmount: number;
  investorWallet: string;
  amountUsd: number;
}

export interface DealFundedPayload extends BasePayload {
  tradeDealId: string;
  commodity: string;
  totalValue: number;
  investors: { email: string; tokenAmount: number }[];
}

export interface DealPublishPayload extends BasePayload {
  dealId: string;
  tokenSymbol: string;
  escrowPublicKey: string;
  encryptedEscrowSecret: string;
  tokenCount: number;
}

export interface DealDeliveredPayload extends BasePayload {
  tradeDealId: string;
}

export interface DealCleanupPayload extends BasePayload {
  tradeDealId: string;
}

const EVENTS = {
  DEAL_DELIVERED: 'deal.delivered',
  INVESTMENT_FUND: 'investment.fund',
  DEAL_FUNDED: 'deal.funded',
  DEAL_PUBLISH: 'deal.publish',
  DEAL_CLEANUP: 'deal.cleanup',
} as const;

@Injectable()
export class QueueService implements TransactionalQueueService {
  constructor(
    @Inject(QUEUE_SERVICE) private readonly client: ClientProxy,
    private readonly logger: PinoLogger,
    private readonly cls: ClsService,
    private readonly outboxService: OutboxService,
  ) {
    (this.logger as any).setContext(QueueService.name);
  }

  public async emit(pattern: string, data: unknown): Promise<void> {
    try {
      this.client.emit(pattern, encryptPayload(data));
      this.logger.info({ event: pattern }, `Emitted event: ${pattern}`);
    } catch (err) {
      this.logger.error(
        { event: pattern, error: err },
        `Failed to emit event ${pattern}`,
      );
      throw err;
    }
  }

  /**
   * REFACTORED: Now uses ClsService instead of private Pino bindings.
   * This ensures the correlationId is pulled from the active request context.
   */
  private addCorrelationId<T>(payload: T): T & BasePayload {
    const correlationId =
      (payload as any).correlationId || this.cls.get('correlationId');

    return {
      ...payload,
      correlationId,
    } as T & BasePayload;
  }

  /**
   * Enqueue a deal.publish job to issue Trade_Token on Stellar
   */
  async enqueueDealPublish(
    payload: Omit<DealPublishPayload, 'correlationId'>,
  ): Promise<void> {
    const enrichedPayload = this.addCorrelationId(payload);
    await this.emit(EVENTS.DEAL_PUBLISH, enrichedPayload);
  }

  /**
   * Enqueue a deal.delivered job to trigger escrow release
   */
  async enqueueDealDelivered(tradeDealId: string): Promise<void> {
    const payload = this.addCorrelationId({ tradeDealId });
    await this.emit(EVENTS.DEAL_DELIVERED, payload);
  }

  /**
   * Enqueue a deal.cleanup job to merge escrow and issuer accounts
   */
  async enqueueDealCleanup(tradeDealId: string): Promise<void> {
    const payload = this.addCorrelationId({ tradeDealId });
    await this.emit(EVENTS.DEAL_CLEANUP, payload);
  }

  async enqueueInvestmentFund(
    payload: Omit<InvestmentFundPayload, 'correlationId'>,
  ): Promise<void> {
    const enrichedPayload = this.addCorrelationId(payload);
    await this.emit(EVENTS.INVESTMENT_FUND, enrichedPayload);
  }

  async enqueueDealFunded(
    payload: Omit<DealFundedPayload, 'correlationId'>,
  ): Promise<void> {
    const enrichedPayload = this.addCorrelationId(payload);
    this.logger.info(
      {
        tradeDealId: enrichedPayload.tradeDealId,
        investorCount: enrichedPayload.investors.length,
      },
      `Deal ${enrichedPayload.tradeDealId} fully funded — notifying ${enrichedPayload.investors.length} investor(s)`,
    );
    await this.emit(EVENTS.DEAL_FUNDED, enrichedPayload);
  }

  // ─── Transactional Outbox Methods ────────────────────────────────────────

  /**
   * Write a deal.publish event to the outbox within the current transaction.
   * Use this when you need atomicity between DB updates and event publishing.
   */
  async enqueueDealPublishTransactional(
    entityManager: EntityManager,
    payload: Omit<DealPublishPayload, 'correlationId'>,
  ): Promise<void> {
    const enrichedPayload = this.addCorrelationId(payload);
    await this.outboxService.writeEvent(
      entityManager,
      EVENTS.DEAL_PUBLISH,
      enrichedPayload,
    );
  }

  /**
   * Write a deal.delivered event to the outbox within the current transaction.
   */
  async enqueueDealDeliveredTransactional(
    entityManager: EntityManager,
    tradeDealId: string,
  ): Promise<void> {
    const payload = this.addCorrelationId({ tradeDealId });
    await this.outboxService.writeEvent(
      entityManager,
      EVENTS.DEAL_DELIVERED,
      payload,
    );
  }

  /**
   * Write a deal.cleanup event to the outbox within the current transaction.
   */
  async enqueueDealCleanupTransactional(
    entityManager: EntityManager,
    tradeDealId: string,
  ): Promise<void> {
    const payload = this.addCorrelationId({ tradeDealId });
    await this.outboxService.writeEvent(
      entityManager,
      EVENTS.DEAL_CLEANUP,
      payload,
    );
  }

  /**
   * Write an investment.fund event to the outbox within the current transaction.
   */
  async enqueueInvestmentFundTransactional(
    entityManager: EntityManager,
    payload: Omit<InvestmentFundPayload, 'correlationId'>,
  ): Promise<void> {
    const enrichedPayload = this.addCorrelationId(payload);
    await this.outboxService.writeEvent(
      entityManager,
      EVENTS.INVESTMENT_FUND,
      enrichedPayload,
    );
  }

  /**
   * Write a deal.funded event to the outbox within the current transaction.
   */
  async enqueueDealFundedTransactional(
    entityManager: EntityManager,
    payload: Omit<DealFundedPayload, 'correlationId'>,
  ): Promise<void> {
    const enrichedPayload = this.addCorrelationId(payload);
    this.logger.info(
      {
        tradeDealId: enrichedPayload.tradeDealId,
        investorCount: enrichedPayload.investors.length,
      },
      `Deal ${enrichedPayload.tradeDealId} fully funded — notifying ${enrichedPayload.investors.length} investor(s)`,
    );
    await this.outboxService.writeEvent(
      entityManager,
      EVENTS.DEAL_FUNDED,
      enrichedPayload,
    );
  }
}
