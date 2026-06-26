import { Module } from '@nestjs/common';
import { QueueAlertService } from './queue-alert.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { QueueService } from './queue.service';
import { QUEUE_SERVICE } from './queue.constants';
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
            queue: 'agric_onchain_queue',
            queueOptions: { durable: true },
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [QueueService, QueueAlertService],
  exports: [QueueService, ClientsModule, QueueAlertService],
})
export class QueueModule {}
