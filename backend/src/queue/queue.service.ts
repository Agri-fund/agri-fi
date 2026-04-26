import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { PinoLogger } from 'nestjs-pino';
import { QUEUE_SERVICE } from './queue.constants';

export interface BasePayload {
  correlationId?: string;
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

const EVENTS = {
  DEAL_DELIVERED: 'deal.delivered',
  INVESTMENT_FUND: 'investment.fund',
  DEAL_FUNDED: 'deal.funded',
  DEAL_PUBLISH: 'deal.publish',
} as const;

@Injectable()
export class QueueService {
  constructor(
    @Inject(QUEUE_SERVICE) private readonly client: ClientProxy,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(QueueService.name);
  }

  public async emit(pattern: string, data: unknown): Promise<void> {
    try {
      this.client.emit(pattern, data);
      this.logger.info({ event: pattern }, `Emitted event: ${pattern}`);
    } catch (err) {
      this.logger.error(
        { event: pattern, error: err },
        `Failed to emit event ${pattern}`,
      );
      throw err;
    }
  }

  private addCorrelationId<T>(payload: T): T & BasePayload {
    return {
      ...payload,
      correlationId:
        (payload as any).correlationId ||
        this.logger.logger.bindings()?.correlationId,
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
}
