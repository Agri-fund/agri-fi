import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';

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
            queue: 'agric_onchain_escrow_queue',
            queueOptions: { durable: true },
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  exports: [ESCROW_QUEUE_SERVICE, ClientsModule],
})
export class EscrowQueueModule {}
