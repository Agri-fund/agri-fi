/**
 * Dead-letter routing for the main and escrow RMQ queues.
 *
 * Each primary queue is bound to a dedicated dead-letter exchange (DLX) via
 * `x-dead-letter-exchange`, so any message that is nacked without requeue
 * (or that expires) is routed to a `<queue>.dlq` queue instead of being
 * dropped. Consumers redirect a message here after
 * MAX_DELIVERY_ATTEMPTS failed processing attempts (see queue.processor.ts).
 */
export const MAX_DELIVERY_ATTEMPTS = 3;

export const MAIN_QUEUE_NAME = 'agric_onchain_queue';
export const MAIN_QUEUE_DLX = 'agric_onchain_queue.dlx';
export const MAIN_QUEUE_DLQ = 'agric_onchain_queue.dlq';

export const ESCROW_QUEUE_NAME = 'agric_onchain_escrow_queue';
export const ESCROW_QUEUE_DLX = 'agric_onchain_escrow_queue.dlx';
export const ESCROW_QUEUE_DLQ = 'agric_onchain_escrow_queue.dlq';

export function dlxQueueOptions(dlxExchange: string) {
  return {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': dlxExchange,
    },
  };
}
