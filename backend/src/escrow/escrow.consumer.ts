import { Injectable, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { EscrowService } from './escrow.service';

interface DealDeliveredPayload {
  tradeDealId: string;
}

@Injectable()
export class EscrowConsumer {
  private readonly logger = new Logger(EscrowConsumer.name);
  private readonly maxRetries = 3;

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

        if (this.isTransientError(error)) {
          this.logger.warn(
            `Transient error processing deal ${tradeDealId} (attempt ${attempt}/${this.maxRetries}): ${error.message}`,
          );

          if (attempt < this.maxRetries) {
            // Exponential backoff: 1s, 2s, 4s
            const delay = Math.pow(2, attempt - 1) * 1000;
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

  private isTransientError(error: any): boolean {
    // Consider Stellar network errors as transient
    if (
      error.message?.includes('stellar') ||
      error.message?.includes('horizon')
    ) {
      return true;
    }

    // Consider timeout errors as transient
    if (
      error.message?.includes('timeout') ||
      error.message?.includes('ETIMEDOUT')
    ) {
      return true;
    }

    // Consider connection errors as transient
    if (
      error.message?.includes('ECONNREFUSED') ||
      error.message?.includes('ENOTFOUND')
    ) {
      return true;
    }

    // Database connection issues
    if (
      error.message?.includes('connection') &&
      error.message?.includes('database')
    ) {
      return true;
    }

    // Default to non-transient for safety
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
