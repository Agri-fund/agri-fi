import { Controller, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { EscrowService } from './escrow.service';
import { IdempotencyService } from '../queue/idempotency.service';
import {
  getDeliveryAttempt,
  isTransientQueueError,
} from '../queue/retry-policy';
import { ESCROW_MAX_DELIVERY_ATTEMPTS } from '../queue/queue.dlq.constants';

interface DealDeliveredPayload {
  tradeDealId: string;
}

/**
 * Consumes deal.delivered events from the escrow queue and triggers the
 * escrow release flow via EscrowService.
 *
 * Retry strategy — broker-level (x-death headers):
 *   • Each failure nacks with requeue=true, causing RabbitMQ to redeliver.
 *   • getDeliveryAttempt() reads the x-death header to count total attempts.
 *   • After ESCROW_MAX_DELIVERY_ATTEMPTS (5) the message is nacked without
 *     requeue, which makes RabbitMQ route it to the configured DLX
 *     (agric_onchain_escrow_queue.dlx) and ultimately land in the DLQ
 *     (agric_onchain_escrow_queue.dlq) where PayoutDeadLetterConsumer picks it up.
 */
@Controller()
export class EscrowConsumer implements OnApplicationShutdown {
  private readonly logger = new Logger(EscrowConsumer.name);

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

  private truncate(value: string, max = 500): string {
    return value.length <= max ? value : `${value.slice(0, max)}…`;
  }

  private rawMessageContent(context: RmqContext): string {
    const message = context.getMessage();
    const content = message?.content;
    if (Buffer.isBuffer(content)) {
      return content.toString('utf8');
    }
    if (typeof content === 'string') {
      return content;
    }
    return '';
  }

  private logMalformedMessage(
    context: RmqContext,
    reason: string,
    raw: string,
  ): void {
    const correlationId = context.getMessage()?.properties?.correlationId;
    this.logger.error(
      {
        correlationId,
        reason,
        rawMessage: this.truncate(raw),
      },
      'Malformed escrow message routed to DLQ',
    );
  }

  private parsePayload(
    payload: unknown,
    context: RmqContext,
  ): DealDeliveredPayload | null {
    try {
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const maybe = payload as Partial<DealDeliveredPayload>;
        if (typeof maybe.tradeDealId === 'string' && maybe.tradeDealId.trim()) {
          return { tradeDealId: maybe.tradeDealId.trim() };
        }
      }

      const raw = typeof payload === 'string' ? payload : this.rawMessageContent(context);
      if (!raw) {
        throw new Error('Empty payload');
      }

      const parsed = JSON.parse(raw) as Partial<DealDeliveredPayload>;
      if (typeof parsed.tradeDealId !== 'string' || !parsed.tradeDealId.trim()) {
        throw new Error('Missing tradeDealId');
      }

      return { tradeDealId: parsed.tradeDealId.trim() };
    } catch (error: any) {
      this.logMalformedMessage(
        context,
        error?.message ?? 'Unable to parse payload',
        typeof payload === 'string' ? payload : this.rawMessageContent(context),
      );
      const channel = context.getChannelRef();
      channel.nack(context.getMessage(), false, false);
      return null;
    }
  }

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
    const parsed = this.parsePayload(payload, context);
    if (!parsed) return;

    const { tradeDealId } = parsed;

    // Derive the current attempt count from broker-tracked x-death headers.
    // On the very first delivery this returns 1; each nack+requeue increments it.
    const attempt = getDeliveryAttempt(originalMsg);
    const exhausted = attempt >= ESCROW_MAX_DELIVERY_ATTEMPTS;

    this.logger.log(
      `Received deal.delivered for deal ${tradeDealId} (attempt ${attempt}/${ESCROW_MAX_DELIVERY_ATTEMPTS})`,
    );

    const idempotencyKey = IdempotencyService.buildKey(
      'deal.delivered',
      tradeDealId,
    );
    const lease = await this.idempotency.acquireLease(idempotencyKey, 900);

    if (!lease.acquired) {
      this.logger.warn(
        `Skipping duplicate deal.delivered for deal ${tradeDealId} (status: ${lease.status ?? 'unknown'})`,
      );
      channel.ack(originalMsg);
      return;
    }

    try {
      await this.escrowService.processDealDelivered(payload);
      await this.idempotency.markDone(idempotencyKey);

      this.logger.log(
        `Successfully processed deal.delivered for deal ${tradeDealId} on attempt ${attempt}`,
      );
      channel.ack(originalMsg);
    } catch (error) {
      await this.idempotency.releaseLease(idempotencyKey);
      const err = error as Error;

      if (exhausted) {
        // All broker-level retries exhausted — route to DLQ.
        this.logger.error(
          `deal.delivered permanently failed for deal ${tradeDealId} after ${attempt} attempts. ` +
            `Routing to DLQ. Last error: ${err.message}`,
          err.stack,
        );
        // nack without requeue → RabbitMQ dead-letters to DLX → DLQ
        channel.nack(originalMsg, false, false);
        return;
      }

      // Transient errors are always requeued (broker handles backoff via TTL
      // policies when configured).  Non-transient errors still get the full
      // 5-attempt allowance so an operator can investigate before the message
      // lands in the DLQ.
      const isTransient = isTransientQueueError(error);
      this.logger.warn(
        `${isTransient ? 'Transient' : 'Non-transient'} error processing deal ${tradeDealId} ` +
          `(attempt ${attempt}/${ESCROW_MAX_DELIVERY_ATTEMPTS}): ${err.message}`,
      );

      // nack with requeue=true → RabbitMQ redelivers; x-death count increments
      channel.nack(originalMsg, false, true);
    }
  }
}
