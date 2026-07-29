import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { PayoutDeadLetterConsumer } from './payout-dead-letter.consumer';
import { NotificationsModule } from '../notifications/notifications.module';
import { QueueModule } from '../queue/queue.module';
import { ESCROW_QUEUE_DLQ } from '../queue/queue.dlq.constants';

/**
 * Token used to inject the DLQ-bound RMQ client when publishing test messages
 * or replay commands to the DLQ in future tooling.
 */
export const ESCROW_DLQ_SERVICE = 'ESCROW_DLQ_SERVICE';

/**
 * Registers a dedicated RabbitMQ client bound to agric_onchain_escrow_queue.dlq
 * and mounts the PayoutDeadLetterConsumer that drains that queue.
 *
 * The DLQ queue was already declared (durable, with no x-dead-letter-exchange
 * so messages don't bounce further) by QueueTopologyService at startup.
 */
@Module({
  imports: [
    ConfigModule,
    NotificationsModule,
    QueueModule, // provides QueueAlertService
    ClientsModule.registerAsync([
      {
        name: ESCROW_DLQ_SERVICE,
        imports: [ConfigModule],
        useFactory: (config: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [
              config.get<string>(
                'RABBITMQ_URL',
                'amqp://guest:guest@localhost:5672',
              ),
            ],
            queue: ESCROW_QUEUE_DLQ,
            queueOptions: {
              // The DLQ itself must NOT have an x-dead-letter-exchange;
              // messages that fail here stay put for manual investigation.
              durable: true,
            },
            noAck: false,
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  controllers: [PayoutDeadLetterConsumer],
})
export class EscrowDlqModule {}
