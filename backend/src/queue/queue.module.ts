import { Module } from '@nestjs/common';
import { QueueAlertService } from './queue-alert.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { QueueService } from './queue.service';
import { QueueTopologyService } from './queue-topology.service';
import { QUEUE_SERVICE } from './queue.constants';
import {
  MAIN_QUEUE_NAME,
  MAIN_QUEUE_DLX,
  dlxQueueOptions,
} from './queue.dlq.constants';
import { HttpModule } from '@nestjs/axios';
export { QUEUE_SERVICE } from './queue.constants';

@Module({
  imports: [
    HttpModule,
    ClientsModule.registerAsync([
      {
        name: QUEUE_SERVICE,
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
            queue: MAIN_QUEUE_NAME,
            queueOptions: dlxQueueOptions(MAIN_QUEUE_DLX),
            prefetchCount: config.get<number>('RABBITMQ_PREFETCH_COUNT', 10),
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [QueueService, QueueAlertService, QueueTopologyService],
  exports: [QueueService, ClientsModule, QueueAlertService],
})
export class QueueModule {}
