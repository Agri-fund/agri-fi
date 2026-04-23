import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { QUEUE_SERVICE } from './queue.constants';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(@Inject(QUEUE_SERVICE) private readonly client: ClientProxy) {}

  async emit(pattern: string, data: unknown): Promise<void> {
    try {
      this.client.emit(pattern, data);
      this.logger.log(`Emitted event: ${pattern}`);
    } catch (err) {
      this.logger.error(`Failed to emit event ${pattern}`, err);
      throw err;
    }
  }

  /**
   * Enqueue a deal.publish job to issue Trade_Token on Stellar
   */
  async enqueueDealPublish(payload: {
    dealId: string;
    tokenSymbol: string;
    escrowPublicKey: string;
    escrowSecretKey: string;
    tokenCount: number;
  }): Promise<void> {
    await this.emit('deal.publish', payload);
  }

  /**
   * Enqueue a deal.delivered job to trigger escrow release
   */
  async enqueueDealDelivered(tradeDealId: string): Promise<void> {
    await this.emit('deal.delivered', { tradeDealId });
  }

  /**
   * Enqueue an investment.fund job to submit the signed XDR and confirm investment
   */
  async enqueueInvestmentFund(payload: {
    investmentId: string;
    signedXdr: string;
    escrowPublicKey: string;
    encryptedEscrowSecret: string;
    assetCode: string;
    tokenAmount: number;
    investorWallet: string;
    amountUsd: number;
  }): Promise<void> {
    await this.emit('investment.fund', payload);
  }

  /**
   * Enqueue a deal.funded notification job to email all participating investors
   */
  async enqueueDealFunded(payload: {
    tradeDealId: string;
    commodity: string;
    totalValue: number;
    investors: { email: string; tokenAmount: number }[];
  }): Promise<void> {
    this.logger.log(
      `Deal ${payload.tradeDealId} fully funded — notifying ${payload.investors.length} investor(s)`,
    );
    await this.emit('deal.funded', payload);
  }
}
