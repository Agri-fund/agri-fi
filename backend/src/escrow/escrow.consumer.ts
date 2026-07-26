import { Controller, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { EscrowService } from './escrow.service';
import {
  DEFAULT_QUEUE_MAX_RETRIES,
  getExponentialBackoffDelayMs,
  isTransientQueueError,
} from '../queue/retry-policy';
import { IdempotencyService } from '../queue/idempotency.service';

interface DealDeliveredPayload {
  tradeDealId: string;
}

@Controller()
export class EscrowConsumer implements OnApplicationShutdown {
  private readonly logger = new Logger(EscrowConsumer.name);
  private readonly maxRetries = DEFAULT_QUEUE_MAX_RETRIES;

  /**
   * Tracks all in-flight handler promises so onApplicationShutdown can await
   * them before the process exits, satisfying #696.
   */
  private readonly activeJobs = new Set<Promise<void>>();

  /** Set to true once shutdown is signalled — new messages are nacked. */
  private shuttingDown = false;

  constructor(
    private readonly escrowService: EscrowService,
    private readonly idempotency: IdempotencyService,
  ) {}

  // ── Shutdown hook (#696) ────────────────────────────────────────────────────

  /**
   * Called by NestJS when the application receives a shutdown signal.
   * Stops accepting new messages and waits for in-flight handlers to complete.
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    this.shuttingDown = true;
    this.logger.log(
      `EscrowConsumer shutting down (signal: ${signal ?? 'unknown'}) — waiting for ${this.activeJobs.size} in-flight job(s)`,
    );

    if (this.activeJobs.size > 0) {
      await Promise.allSettled(Array.from(this.activeJobs));
    }

    this.logger.log('EscrowConsumer shutdown complete — all jobs finished');
  }

  // ── Event handler ────────────────────────────────────────────────────────────

  @EventPattern('deal.delivered')
  handleDealDelivered(
    @Payload() payload: DealDeliveredPayload,
    @Ctx() context: RmqContext,
  ): void {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    if (this.shuttingDown) {
      // Return message to queue so the next healthy replica picks it up
      this.logger.warn(
        `deal.delivered received during shutdown — requeueing message for deal ${payload?.tradeDealId}`,
      );
      channel.nack(originalMsg, false, true);
      return;
    }

    const job = this.processDealDelivered(
      payload,
      channel,
      originalMsg,
    ).finally(() => this.activeJobs.delete(job));

    this.activeJobs.add(job);
  }

  private async processDealDelivered(
    payload: DealDeliveredPayload,
    channel: any,
    originalMsg: any,
  ): Promise<void> {
    const { tradeDealId } = payload;

    this.logger.log(`Received deal.delivered event for deal ${tradeDealId}`);

    // ── Idempotency check (#687) ───────────────────────────────────────────
    const idemKey = IdempotencyService.buildKey('deal.delivered', tradeDealId);
    const lease = await this.idempotency.acquireLease(idemKey);
    if (!lease.acquired) {
      this.logger.log(
        `deal.delivered duplicate for deal ${tradeDealId} (status: ${lease.status}) — acking without reprocessing`,
      );
      channel.ack(originalMsg);
      return;
    }

    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < this.maxRetries) {
      attempt++;

      try {
        await this.escrowService.processDealDelivered(payload);
        this.logger.log(
          `Successfully processed deal.delivered for deal ${tradeDealId} on attempt ${attempt}`,
        );

        await this.idempotency.markDone(idemKey);
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
          // Non-transient error — stop retrying immediately
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

    // Release the idempotency lease so a future redelivery can retry
    await this.idempotency.releaseLease(idemKey);

    // Nack without requeue — RabbitMQ will dead-letter the message to the DLX
    channel.nack(originalMsg, false, false);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
