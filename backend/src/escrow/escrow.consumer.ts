import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { EscrowService } from './escrow.service';
import {
  DEFAULT_QUEUE_MAX_RETRIES,
  getExponentialBackoffDelayMs,
  isTransientQueueError,
} from '../queue/retry-policy';

interface DealDeliveredPayload {
  tradeDealId: string;
}

@Controller()
export class EscrowConsumer {
  private readonly logger = new Logger(EscrowConsumer.name);
  private readonly maxRetries = DEFAULT_QUEUE_MAX_RETRIES;

  constructor(private readonly escrowService: EscrowService) {}

  @EventPattern('deal.delivered')
  async handleDealDelivered(
    @Payload() payload: DealDeliveredPayload,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const { tradeDealId } = payload;

    this.logger.log(`Received deal.delivered event for deal ${tradeDealId}`);

    let attempt = 0;
    let lastError: Error | null = null;
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    while (attempt < this.maxRetries) {
      attempt++;

      try {
        await this.escrowService.processDealDelivered(payload);
        this.logger.log(
          `Successfully processed deal.delivered for deal ${tradeDealId} on attempt ${attempt}`,
        );
        channel.ack(originalMsg);
        return;
      } catch (error) {
        lastError = error as Error;

        if (isTransientQueueError(error)) {
          this.logger.warn(
            `Transient error processing deal ${tradeDealId} (attempt ${attempt}/${this.maxRetries}): ${error.message}`,
          );

          if (attempt < this.maxRetries) {
            const delay = getExponentialBackoffDelayMs(attempt, 1000);
            await this.sleep(delay);
            continue;
          }
        } else {
          // Non-transient error, don't retry
          this.logger.error(
            `Non-transient error processing deal ${tradeDealId}: ${error.message}`,
            error.stack,
          );
          break;
        }
      }
    }

    // All retries exhausted or non-transient error
    this.logger.error(
      `Failed to process deal.delivered for deal ${tradeDealId} after ${attempt} attempts. Last error: ${lastError?.message}`,
      lastError?.stack,
    );

    // The error handling (admin alerts, etc.) is already done in EscrowService
    // We don't re-throw here to prevent the message from being requeued indefinitely
    channel.nack(originalMsg, false, false);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
