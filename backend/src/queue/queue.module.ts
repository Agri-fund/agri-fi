import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { QueueService } from './queue.service';
import { QueueProcessor } from './queue.processor';
import { TradeDealsModule } from '../trade-deals/trade-deals.module';
import { StellarModule } from '../stellar/stellar.module';

export const QUEUE_SERVICE = 'QUEUE_SERVICE';

@Global()
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: QUEUE_SERVICE,
        imports: [ConfigModule],
        useFactory: (config: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.get<string>('RABBITMQ_URL', 'amqp://guest:guest@localhost:5672')],
            queue: 'agric_onchain_queue',
            queueOptions: { durable: true },
          },
        }),
        inject: [ConfigService],
      },
    ]),
    TradeDealsModule,
    StellarModule,
  ],
  providers: [QueueService, QueueProcessor],
  exports: [QueueService, ClientsModule],
})
export class QueueModule {}
