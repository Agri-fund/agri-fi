import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { EscrowService } from './escrow.service';
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
export class EscrowConsumer {
  private readonly logger = new Logger(EscrowConsumer.name);

  constructor(private readonly escrowService: EscrowService) {}

  @EventPattern('deal.delivered')
  async handleDealDelivered(
    @Payload() payload: DealDeliveredPayload,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    const { tradeDealId } = payload;

    // Derive the current attempt count from broker-tracked x-death headers.
    // On the very first delivery this returns 1; each nack+requeue increments it.
    const attempt = getDeliveryAttempt(originalMsg);
    const exhausted = attempt >= ESCROW_MAX_DELIVERY_ATTEMPTS;

    this.logger.log(
      `Received deal.delivered for deal ${tradeDealId} (attempt ${attempt}/${ESCROW_MAX_DELIVERY_ATTEMPTS})`,
    );

    try {
      await this.escrowService.processDealDelivered(payload);

      this.logger.log(
        `Successfully processed deal.delivered for deal ${tradeDealId} on attempt ${attempt}`,
      );
      channel.ack(originalMsg);
    } catch (error) {
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
