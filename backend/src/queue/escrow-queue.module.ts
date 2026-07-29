import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import {
  ESCROW_QUEUE_NAME,
  ESCROW_QUEUE_DLX,
  dlxQueueOptions,
} from './queue.dlq.constants';

export const ESCROW_QUEUE_SERVICE = 'ESCROW_QUEUE_SERVICE';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: ESCROW_QUEUE_SERVICE,
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
            queue: ESCROW_QUEUE_NAME,
            queueOptions: dlxQueueOptions(ESCROW_QUEUE_DLX),
            prefetchCount: config.get<number>('RABBITMQ_PREFETCH_COUNT', 10),
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  exports: [ESCROW_QUEUE_SERVICE, ClientsModule],
})
export class EscrowQueueModule {}
