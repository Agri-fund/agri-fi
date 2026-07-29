import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { ClientProxy, ClientProxyFactory, Transport } from '@nestjs/microservices';
import { OutboxEntity } from './outbox.entity';
import { OutboxService } from './outbox.service';
import { encryptPayload } from '../queue/queue.crypto';

const BATCH_SIZE = 50;
const MAX_RETRIES = 10;

@Injectable()
export class OutboxProcessor implements OnModuleInit, OnModuleDestroy {
  private client: ClientProxy;
  private isProcessing = false;

  constructor(
    private readonly outboxService: OutboxService,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutboxProcessor.name);
  }

  onModuleInit(): void {
    const rabbitmqUrl = this.config.get<string>(
      'RABBITMQ_URL',
      'amqp://guest:guest@localhost:5672',
    );

    this.client = ClientProxyFactory.create({
      transport: Transport.RMQ,
      options: {
        urls: [rabbitmqUrl],
        queue: 'outbox-processor',
      },
    });
    this.client.connect();
  }

  @Cron(CronExpression.EVERY_SECOND)
  async processOutbox(): Promise<void> {
    if (this.isProcessing) {
      this.logger.trace('Outbox processor already running, skipping this tick');
      return;
    }

    this.isProcessing = true;

    try {
      const events = await this.outboxService.getUnprocessedEvents(BATCH_SIZE);

      if (events.length === 0) {
        this.logger.trace('No unprocessed outbox events');
        return;
      }

      this.logger.debug(
        { count: events.length },
        `Processing ${events.length} outbox event(s)`,
      );

      for (const event of events) {
        await this.processEvent(event);
      }
    } catch (error) {
      this.logger.error(
        { error: error.message, stack: error.stack },
        'Outbox processor error',
      );
    } finally {
      this.isProcessing = false;
    }
  }

  private async processEvent(event: OutboxEntity): Promise<void> {
    try {
      // Encrypt the payload before sending to RabbitMQ
      const encryptedPayload = encryptPayload(event.payload);

      // Emit to RabbitMQ
      await this.client.emit(event.eventType, encryptedPayload).toPromise();

      // Mark as processed
      await this.outboxService.markProcessed(event.id);

      this.logger.debug(
        { eventId: event.id, eventType: event.eventType },
        `Successfully processed outbox event`,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Increment retry count and store error
      await this.outboxService.markFailed(event.id, errorMessage);

      this.logger.warn(
        { eventId: event.id, eventType: event.eventType, error: errorMessage, retryCount: event.retryCount + 1 },
        `Failed to process outbox event, will retry`,
      );

      // If max retries exceeded, log as dead letter
      if (event.retryCount + 1 >= MAX_RETRIES) {
        this.logger.error(
          { eventId: event.id, eventType: event.eventType, error: errorMessage, retryCount: event.retryCount + 1 },
          `Outbox event exceeded max retries (${MAX_RETRIES}), moving to dead letter`,
        );
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.close();
    }
  }
}