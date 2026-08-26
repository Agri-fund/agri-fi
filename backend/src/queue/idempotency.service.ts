import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { createClient, RedisClientType } from 'redis';

/**
 * Idempotency status for a given message key.
 */
export type IdempotencyStatus = 'acquired' | 'processing' | 'done';

/**
 * Result of attempting to acquire an idempotency lease.
 */
export interface IdempotencyAcquireResult {
  /** Whether this consumer acquired the lease (should proceed with processing). */
  acquired: boolean;
  /** Current status of the key, if the lease was not acquired. */
  status?: IdempotencyStatus;
}

/**
 * IdempotencyService (#687)
 *
 * Prevents duplicate processing of the same RabbitMQ message across consumer
 * replicas or redeliveries (e.g. cluster failover, nack-requeue cycles).
 *
 * Protocol:
 *  1. Consumer calls acquireLease(key, ttlSec).
 *     - If key does not exist → SET key "processing" NX EX ttl → acquired=true
 *     - If key exists with value "done"    → duplicate, skip (acquired=false, status="done")
 *     - If key exists with value "processing" → another replica is working (acquired=false, status="processing")
 *  2. On successful completion → consumer calls markDone(key, persistTtlSec).
 *  3. On failure or ack-less paths  → consumer calls releaseLease(key) to
 *     remove the processing lock so the redelivery can be retried.
 *
 * The key should be a stable, business-level identifier derived from the
 * message payload (e.g. "idempotency:deal.publish:<dealId>") — NOT the
 * RabbitMQ delivery tag (which changes on redelivery).
 *
 * Falls back to a no-op (always acquired) when REDIS_URL is not configured,
 * so local dev without Redis keeps working.
 */
@Injectable()
export class IdempotencyService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType | null = null;
  private connected = false;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(IdempotencyService.name);
  }

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get<string>('REDIS_URL', '').trim();
    if (!redisUrl) {
      this.logger.warn(
        'REDIS_URL is not set — IdempotencyService running in no-op mode (no duplicate protection)',
      );
      return;
    }

    this.client = createClient({ url: redisUrl }) as RedisClientType;

    this.client.on('error', (err: Error) => {
      this.logger.error(
        { error: err.message },
        'IdempotencyService Redis client error',
      );
    });

    try {
      await this.client.connect();
      this.connected = true;
      this.logger.info('IdempotencyService connected to Redis');
    } catch (err: any) {
      this.logger.error(
        { error: err.message },
        'IdempotencyService failed to connect to Redis — running in no-op mode',
      );
      this.client = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client && this.connected) {
      try {
        await this.client.quit();
        this.logger.info('IdempotencyService Redis client disconnected');
      } catch (err: any) {
        this.logger.warn(
          { error: err.message },
          'IdempotencyService Redis client disconnect error',
        );
      }
    }
  }

  /**
   * Try to acquire a processing lease for the given idempotency key.
   *
   * @param key       Stable business-level key, e.g. "idempotency:deal.publish:uuid"
   * @param ttlSec    Lease duration in seconds (processing timeout guard)
   */
  async acquireLease(
    key: string,
    ttlSec = 300,
  ): Promise<IdempotencyAcquireResult> {
    if (!this.client || !this.connected) {
      // No-op mode: always allow processing
      return { acquired: true };
    }

    // Check if already done (successful completion persisted)
    const existing = await this.client.get(key);

    if (existing === 'done') {
      this.logger.info(
        { key },
        'Idempotency: message already processed successfully — skipping',
      );
      return { acquired: false, status: 'done' };
    }

    if (existing === 'processing') {
      this.logger.warn(
        { key },
        'Idempotency: message is already being processed by another consumer — skipping',
      );
      return { acquired: false, status: 'processing' };
    }

    // Attempt atomic SET NX (only set if key does not exist)
    const result = await this.client.set(key, 'processing', {
      NX: true,
      EX: ttlSec,
    });

    if (result === null) {
      // Another consumer beat us to it between the GET and SET — unlikely but safe
      const currentStatus = (await this.client.get(key)) ?? 'processing';
      this.logger.warn(
        { key },
        `Idempotency: race condition — key set by another consumer (status: ${currentStatus})`,
      );
      return { acquired: false, status: currentStatus as IdempotencyStatus };
    }

    return { acquired: true };
  }

  /**
   * Mark processing as successfully completed. The key is updated to "done"
   * and kept in Redis for `persistTtlSec` seconds so that late redeliveries
   * are still recognized as duplicates.
   *
   * @param key           The same key passed to acquireLease
   * @param persistTtlSec How long to keep the "done" marker (default: 24 h)
   */
  async markDone(key: string, persistTtlSec = 86_400): Promise<void> {
    if (!this.client || !this.connected) return;

    await this.client.set(key, 'done', { EX: persistTtlSec });
    this.logger.info({ key }, 'Idempotency: marked key as done');
  }

  /**
   * Release the processing lease without marking as done.
   * Call this when processing fails permanently so the next redelivery
   * can re-acquire the lease and retry.
   *
   * @param key The same key passed to acquireLease
   */
  async releaseLease(key: string): Promise<void> {
    if (!this.client || !this.connected) return;

    const current = await this.client.get(key);
    // Only delete if still in "processing" state — don't delete a "done" entry
    if (current === 'processing') {
      await this.client.del(key);
      this.logger.info(
        { key },
        'Idempotency: processing lease released for retry',
      );
    }
  }

  /**
   * Build a canonical idempotency key for a given event and business ID.
   * e.g. buildKey('deal.publish', 'deal-uuid-123')
   *      → "idempotency:deal.publish:deal-uuid-123"
   */
  static buildKey(event: string, businessId: string): string {
    return `idempotency:${event}:${businessId}`;
  }
}
