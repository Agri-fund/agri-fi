export const QUEUE_SERVICE = 'QUEUE_SERVICE';
export const TRANSACTIONAL_QUEUE_SERVICE = 'TRANSACTIONAL_QUEUE_SERVICE';

/**
 * Canonical RabbitMQ routing keys.
 *
 * NOTE: This file previously only exported the DI tokens above. The routing
 * key constants and the single-ownership registry below are the source of
 * truth for "which consumer class owns which routing key" (see issue #959).
 * Keep this list in sync with `queue.dlq.constants.ts` and the escrow event
 * names; the architecture test (`routing-key-ownership.arch-spec.ts`) guards
 * the single-ownership invariant.
 */

/** Primary queue routing keys. */
export const ROUTING_KEYS = {
  /** Escrow lifecycle events (canonical owner: EscrowConsumer). */
  ESCROW_CREATED: 'escrow.created',
  ESCROW_FUNDED: 'escrow.funded',
  ESCROW_RELEASED: 'escrow.released',
  ESCROW_REFUNDED: 'escrow.refunded',
  ESCROW_DISPUTED: 'escrow.disputed',
  ESCROW_RESOLVED: 'escrow.resolved',

  /** Transactional / notification events (canonical owner: QueueProcessor). */
  TRANSACTION_CREATED: 'transaction.created',
  TRANSACTION_UPDATED: 'transaction.updated',
  NOTIFICATION_SEND: 'notification.send',
  RECONCILE_ESCROW: 'reconcile.escrow',
} as const;

export type RoutingKey = (typeof ROUTING_KEYS)[keyof typeof ROUTING_KEYS];

/** Dead-letter routing keys (canonical owner: the DLQ consumer). */
export const DLQ_ROUTING_KEYS = {
  ESCROW_DLQ: 'escrow.dlq',
  TRANSACTION_DLQ: 'transaction.dlq',
  NOTIFICATION_DLQ: 'notification.dlq',
} as const;

export type DlqRoutingKey =
  (typeof DLQ_ROUTING_KEYS)[keyof typeof DLQ_ROUTING_KEYS];

/** All routing keys (primary + DLQ) handled by the system. */
export type AnyRoutingKey = RoutingKey | DlqRoutingKey;

/**
 * Canonical consumer class names. These are string identifiers (not imports)
 * so this module stays free of circular dependencies and can be imported by
 * both the runtime wiring and the architecture test.
 */
export const CONSUMER_CLASSES = {
  QUEUE_PROCESSOR: 'QueueProcessor',
  ESCROW_CONSUMER: 'EscrowConsumer',
  DLQ_CONSUMER: 'DlqConsumer',
} as const;

export type ConsumerClassName =
  (typeof CONSUMER_CLASSES)[keyof typeof CONSUMER_CLASSES];

/**
 * Single-ownership registry: every routing key maps to exactly one consumer
 * class. This is the source of truth used by the architecture test.
 *
 * Decision (issue #959): escrow event handling lives canonically in
 * `escrow/escrow.consumer.ts` (EscrowConsumer). The duplicate escrow handlers
 * in `queue/queue.processor.ts` have been removed. Transactional and
 * notification events remain owned by QueueProcessor. All dead-letter keys are
 * owned by the DLQ consumer.
 */
export const ROUTING_KEY_OWNERS: Readonly<Record<AnyRoutingKey, ConsumerClassName>> = {
  // Escrow events -> EscrowConsumer (canonical home: escrow/)
  [ROUTING_KEYS.ESCROW_CREATED]: CONSUMER_CLASSES.ESCROW_CONSUMER,
  [ROUTING_KEYS.ESCROW_FUNDED]: CONSUMER_CLASSES.ESCROW_CONSUMER,
  [ROUTING_KEYS.ESCROW_RELEASED]: CONSUMER_CLASSES.ESCROW_CONSUMER,
  [ROUTING_KEYS.ESCROW_REFUNDED]: CONSUMER_CLASSES.ESCROW_CONSUMER,
  [ROUTING_KEYS.ESCROW_DISPUTED]: CONSUMER_CLASSES.ESCROW_CONSUMER,
  [ROUTING_KEYS.ESCROW_RESOLVED]: CONSUMER_CLASSES.ESCROW_CONSUMER,

  // Transactional / notification events -> QueueProcessor
  [ROUTING_KEYS.TRANSACTION_CREATED]: CONSUMER_CLASSES.QUEUE_PROCESSOR,
  [ROUTING_KEYS.TRANSACTION_UPDATED]: CONSUMER_CLASSES.QUEUE_PROCESSOR,
  [ROUTING_KEYS.NOTIFICATION_SEND]: CONSUMER_CLASSES.QUEUE_PROCESSOR,
  [ROUTING_KEYS.RECONCILE_ESCROW]: CONSUMER_CLASSES.QUEUE_PROCESSOR,

  // Dead-letter keys -> DLQ consumer
  [DLQ_ROUTING_KEYS.ESCROW_DLQ]: CONSUMER_CLASSES.DLQ_CONSUMER,
  [DLQ_ROUTING_KEYS.TRANSACTION_DLQ]: CONSUMER_CLASSES.DLQ_CONSUMER,
  [DLQ_ROUTING_KEYS.NOTIFICATION_DLQ]: CONSUMER_CLASSES.DLQ_CONSUMER,
};

/**
 * Asserts that every routing key has exactly one owner and that the registry
 * covers all known routing keys. Throws at module load if the invariant is
 * violated, so misconfiguration fails fast rather than double-processing.
 */
export function assertRoutingKeyOwnership(
  registry: Readonly<Record<string, ConsumerClassName>> = ROUTING_KEY_OWNERS,
): void {
  const allKeys: string[] = [
    ...Object.values(ROUTING_KEYS),
    ...Object.values(DLQ_ROUTING_KEYS),
  ];

  const seen = new Set<string>();
  for (const key of allKeys) {
    if (seen.has(key)) {
      throw new Error(
        `Duplicate routing key definition detected: "${key}". Each routing key must be declared once.`,
      );
    }
    seen.add(key);
  }

  for (const key of allKeys) {
    const owner = registry[key];
    if (!owner) {
      throw new Error(
        `Routing key "${key}" has no registered consumer owner. Every routing key must map to exactly one consumer class.`,
      );
    }
  }

  for (const key of Object.keys(registry)) {
    if (!seen.has(key)) {
      throw new Error(
        `Routing key "${key}" is registered in ROUTING_KEY_OWNERS but is not a known routing key constant.`,
      );
    }
  }
}

// Fail fast at module load if the single-ownership invariant is broken.
assertRoutingKeyOwnership();
