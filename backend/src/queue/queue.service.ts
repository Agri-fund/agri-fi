import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { QUEUE_SERVICE } from './queue.module';

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
   * Enqueue a deal.delivered job to trigger escrow release
   */
  async enqueueDealDelivered(tradeDealId: string): Promise<void> {
    await this.emit('deal.delivered', { tradeDealId });
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
