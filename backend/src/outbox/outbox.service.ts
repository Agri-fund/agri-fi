import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, QueryRunner } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { OutboxEntity, OutboxEvent } from './outbox.entity';

@Injectable()
export class OutboxService {
  constructor(
    @InjectRepository(OutboxEntity)
    private readonly outboxRepo: Repository<OutboxEntity>,
    private readonly dataSource: DataSource,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutboxService.name);
  }

  /**
   * Write an event to the outbox table within the current transaction.
   * This should be called from within a transactional context (e.g., using @Transactional or QueryRunner).
   */
  async writeEvent(
    queryRunner: QueryRunner,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const outboxEvent = this.outboxRepo.create({
      eventType,
      payload,
      processed: false,
      retryCount: 0,
    });

    await queryRunner.manager.save(outboxEvent);
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
    queryRunner: QueryRunner,
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

    await queryRunner.manager.save(outboxEvents);
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
}