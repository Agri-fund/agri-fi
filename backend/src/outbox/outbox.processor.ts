import {
  Inject,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge } from 'prom-client';
import { RedisClientType } from 'redis';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import {
  ClientProxy,
  ClientProxyFactory,
  Transport,
} from '@nestjs/microservices';
import { OutboxEntity } from './outbox.entity';
import { OutboxService } from './outbox.service';
import { encryptPayload } from '../queue/queue.crypto';

export const OUTBOX_REDIS_CLIENT = 'OUTBOX_REDIS_CLIENT';
const LEASE_KEY = 'outbox:processor:lease';
const LEASE_TTL_MS = 10_000;
// Delete the lease only if we still own it.
const RELEASE_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
const BATCH_SIZE = 50;
const MAX_RETRIES = 10;

@Injectable()
export class OutboxProcessor implements OnModuleInit, OnModuleDestroy {
  private client: ClientProxy;
  private isProcessing = false;
  private readonly leaseOwner = randomUUID();

  constructor(
    private readonly outboxService: OutboxService,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
    @Inject(OUTBOX_REDIS_CLIENT)
    private readonly redis:
      Promise<RedisClientType | null> | RedisClientType | null,
    @InjectMetric('outbox_lease_contention_total')
    private readonly leaseContention: Counter<string>,
    @InjectMetric('outbox_processor_active')
    private readonly processorActive: Gauge<string>,
  ) {
    (this.logger as any).setContext(OutboxProcessor.name);
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

  /** Returns the connected Redis client, or null when Redis is not configured. */
  private async redisClient(): Promise<RedisClientType | null> {
    const client = await this.redis;
    if (client && !client.isOpen) await client.connect();
    return client;
  }

  private async acquireLease(): Promise<boolean> {
    const redis = await this.redisClient();
    // Without Redis, fall back to FOR UPDATE SKIP LOCKED only.
    if (!redis) return true;
    const res = await redis.set(LEASE_KEY, this.leaseOwner, {
      NX: true,
      PX: LEASE_TTL_MS,
    });
    return res === 'OK';
  }

  private async releaseLease(): Promise<void> {
    const redis = await this.redisClient();
    if (!redis) return;
    await redis.eval(RELEASE_SCRIPT, {
      keys: [LEASE_KEY],
      arguments: [this.leaseOwner],
    });
  }

  @Cron(CronExpression.EVERY_SECOND)
  async processOutbox(): Promise<void> {
    if (this.isProcessing) {
      this.logger.trace('Outbox processor already running, skipping this tick');
      return;
    }

    this.isProcessing = true;
    let leased = false;

    try {
      leased = await this.acquireLease();
      if (!leased) {
        this.leaseContention.inc();
        this.logger.trace('Outbox lease held by another replica, skipping');
        return;
      }
      this.processorActive.set(1);

      const events = await this.outboxService.publishPending(BATCH_SIZE);

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
      if (leased) {
        this.processorActive.set(0);
        await this.releaseLease().catch((err) =>
          this.logger.warn({ error: err.message }, 'Failed to release lease'),
        );
      }
      this.isProcessing = false;
    }
  }

  private async processEvent(event: OutboxEntity): Promise<void> {
    try {
      // Bind the event type as AAD, matching how QueueService publishes and
      // how the consumer verifies the payload.
      const encryptedPayload = encryptPayload(event.payload, event.eventType);

      await this.client.emit(event.eventType, encryptedPayload).toPromise();

      await this.outboxService.markProcessed(event.id);

      this.logger.debug(
        { eventId: event.id, eventType: event.eventType },
        `Successfully processed outbox event`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await this.outboxService.markFailed(event.id, errorMessage);
      this.outboxService.recordPublishError(event.eventType);

      this.logger.warn(
        {
          eventId: event.id,
          eventType: event.eventType,
          error: errorMessage,
          retryCount: event.retryCount + 1,
        },
        `Failed to process outbox event, will retry`,
      );

      if (event.retryCount + 1 >= MAX_RETRIES) {
        this.logger.error(
          {
            eventId: event.id,
            eventType: event.eventType,
            error: errorMessage,
            retryCount: event.retryCount + 1,
          },
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
