import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge } from 'prom-client';
import { OutboxEntity, OutboxEvent } from './outbox.entity';

@Injectable()
export class OutboxService {
  constructor(
    @InjectRepository(OutboxEntity)
    private readonly outboxRepo: Repository<OutboxEntity>,
    private readonly dataSource: DataSource,
    private readonly logger: PinoLogger,
    @InjectMetric('outbox_pending_events_total')
    private readonly pendingEventsGauge: Gauge<string>,
    @InjectMetric('outbox_publish_errors_total')
    private readonly publishErrorsCounter: Counter<string>,
  ) {
    this.logger.setContext(OutboxService.name);
  }

  /**
   * Write an event to the outbox table within the current transaction.
   * This should be called from within a transactional context (e.g., using @Transactional or EntityManager).
   */
  async writeEvent(
    entityManager: EntityManager,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const outboxEvent = this.outboxRepo.create({
      eventType,
      payload,
      processed: false,
      retryCount: 0,
    });

    await entityManager.save(outboxEvent);
    this.logger.debug(
      { eventType, payloadKeys: Object.keys(payload) },
      `Event written to outbox: ${eventType}`,
    );
  }

  /**
   * Write an event to the outbox table using the default repository (outside transaction).
   * Use this for non-transactional event publishing.
   */
  async writeEventDirect(
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const outboxEvent = this.outboxRepo.create({
      eventType,
      payload,
      processed: false,
      retryCount: 0,
    });

    await this.outboxRepo.save(outboxEvent);
    this.logger.debug(
      { eventType, payloadKeys: Object.keys(payload) },
      `Event written to outbox (direct): ${eventType}`,
    );
  }

  /**
   * Write multiple events to the outbox within a transaction.
   */
  async writeEvents(
    entityManager: EntityManager,
    events: OutboxEvent[],
  ): Promise<void> {
    const outboxEvents = events.map((event) =>
      this.outboxRepo.create({
        eventType: event.eventType,
        payload: event.payload,
        processed: false,
        retryCount: 0,
      }),
    );

    await entityManager.save(outboxEvents);
    this.logger.debug(
      { eventCount: events.length, eventTypes: events.map((e) => e.eventType) },
      `Batch wrote ${events.length} events to outbox`,
    );
  }

  /**
   * Get unprocessed events from the outbox for processing.
   * Returns events ordered by creation time (FIFO).
   */
  async getUnprocessedEvents(limit: number = 100): Promise<OutboxEntity[]> {
    return this.outboxRepo.find({
      where: { processed: false },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  /**
   * Atomically claim a batch of unprocessed outbox events using
   * SELECT FOR UPDATE SKIP LOCKED so concurrent processors do not
   * block each other. Returns the claimed events (already locked
   * to this transaction) or an empty array if nothing is available.
   */
  async publishPending(limit: number = 50): Promise<OutboxEntity[]> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.query('BEGIN');

      const rows = await queryRunner.query(
        `SELECT id, event_type, payload, processed, retry_count, last_error,
                created_at, updated_at, processed_at
         FROM outbox
         WHERE processed = FALSE AND retry_count < 10
         ORDER BY created_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [limit],
      );

      await queryRunner.query('COMMIT');

      this.pendingEventsGauge.set(rows.length);

      return rows.map((row: any) => {
        const entity = new OutboxEntity();
        entity.id = row.id;
        entity.eventType = row.event_type;
        entity.payload = row.payload;
        entity.processed = row.processed;
        entity.retryCount = row.retry_count;
        entity.lastError = row.last_error;
        entity.createdAt = row.created_at;
        entity.updatedAt = row.updated_at;
        entity.processedAt = row.processed_at;
        return entity;
      });
    } catch (error) {
      await queryRunner.query('ROLLBACK');
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Record a publish error for Prometheus tracking.
   */
  recordPublishError(eventType: string): void {
    this.publishErrorsCounter.inc({ event_type: eventType });
  }

  /**
   * Mark an outbox event as processed.
   */
  async markProcessed(id: string): Promise<void> {
    await this.outboxRepo.update(id, {
      processed: true,
      processedAt: new Date(),
    });
  }

  /**
   * Mark an outbox event as failed (increment retry count, store error).
   */
  async markFailed(id: string, error: string): Promise<void> {
    await this.outboxRepo.increment({ id }, 'retryCount', 1);
    await this.outboxRepo.update(id, { lastError: error });
  }

  /**
   * Get events that have failed too many times (for DLQ/monitoring).
   */
  async getDeadLetterEvents(maxRetries: number = 10): Promise<OutboxEntity[]> {
    return this.outboxRepo.find({
      where: { processed: false },
      order: { createdAt: 'ASC' },
    }).then((events) => events.filter((e) => e.retryCount >= maxRetries));
  }

  /**
   * Delete processed events older than a certain date (cleanup).
   */
  async cleanupProcessedEvents(olderThan: Date): Promise<number> {
    const result = await this.outboxRepo.delete({
      processed: true,
      processedAt: olderThan,
    });
    return result.affected ?? 0;
  }

  /**
   * Move events that have exceeded max retries to the dead-letter table
   * and delete them from the outbox.
   */
  async moveToDeadLetter(maxRetries: number = 10): Promise<number> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.query('BEGIN');

      const moved = await queryRunner.query(
        `INSERT INTO outbox_dead_letter
           (original_event_id, event_type, payload, retry_count, last_error)
         SELECT id, event_type, payload, retry_count, last_error
         FROM outbox
         WHERE processed = FALSE AND retry_count >= $1
         RETURNING original_event_id`,
        [maxRetries],
      );

      if (moved.length > 0) {
        const ids = moved.map((r: any) => r.original_event_id);
        await queryRunner.query(
          `DELETE FROM outbox WHERE id = ANY($1::uuid[])`,
          [ids],
        );
      }

      await queryRunner.query('COMMIT');
      return moved.length;
    } catch (error) {
      await queryRunner.query('ROLLBACK');
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}