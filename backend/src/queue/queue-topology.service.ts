import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import * as amqp from 'amqplib';
import {
  MAIN_QUEUE_NAME,
  MAIN_QUEUE_DLX,
  MAIN_QUEUE_DLQ,
  ESCROW_QUEUE_NAME,
  ESCROW_QUEUE_DLX,
  ESCROW_QUEUE_DLQ,
  dlxQueueOptions,
} from './queue.dlq.constants';

/**
 * Declares the dead-letter exchanges, DLQ queues, and bindings for the main
 * and escrow queues on startup. @nestjs/microservices' RMQ client only
 * asserts the primary queue — it has no concept of exchanges/bindings — so
 * this runs a plain amqplib channel once at boot to set up the DLX topology
 * before any consumer/producer connects.
 */
@Injectable()
export class QueueTopologyService implements OnModuleInit {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    (this.logger as any).setContext(QueueTopologyService.name);
  }

  async onModuleInit(): Promise<void> {
    const url = this.config.get<string>(
      'RABBITMQ_URL',
      'amqp://guest:guest@localhost:5672',
    );

    let connection: amqp.ChannelModel | undefined;
    try {
      connection = await amqp.connect(url);
      const channel = await connection.createChannel();

      await this.declareDlqTopology(
        channel,
        MAIN_QUEUE_NAME,
        MAIN_QUEUE_DLX,
        MAIN_QUEUE_DLQ,
      );
      await this.declareDlqTopology(
        channel,
        ESCROW_QUEUE_NAME,
        ESCROW_QUEUE_DLX,
        ESCROW_QUEUE_DLQ,
      );

      await channel.close();
      this.logger.info('RabbitMQ DLQ topology declared');
    } catch (err: any) {
      this.logger.error(
        { error: err.message },
        'Failed to declare RabbitMQ DLQ topology',
      );
    } finally {
      await connection?.close();
    }
  }

  private async declareDlqTopology(
    channel: amqp.Channel,
    queueName: string,
    dlxName: string,
    dlqName: string,
  ): Promise<void> {
    // Dead-letter exchange + queue that failed messages land in.
    await channel.assertExchange(dlxName, 'fanout', { durable: true });
    await channel.assertQueue(dlqName, { durable: true });
    await channel.bindQueue(dlqName, dlxName, '');

    // Primary queue, wired to route dead-lettered messages to the DLX above.
    await channel.assertQueue(queueName, dlxQueueOptions(dlxName));
  }
}
