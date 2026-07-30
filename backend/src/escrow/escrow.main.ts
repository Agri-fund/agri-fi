import { NestFactory } from '@nestjs/core';
import { EscrowModule } from './escrow.module';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import {
  ESCROW_QUEUE_NAME,
  ESCROW_QUEUE_DLX,
  ESCROW_QUEUE_DLQ,
  dlxQueueOptions,
} from '../queue/queue.dlq.constants';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    EscrowModule,
    {
      transport: Transport.RMQ,
      options: {
        urls: [
          new ConfigService().get<string>(
            'RABBITMQ_URL',
            'amqp://guest:guest@localhost:5672',
          ),
        ],
        queue: ESCROW_QUEUE_NAME,
        queueOptions: dlxQueueOptions(ESCROW_QUEUE_DLX),
        prefetchCount: parseInt(
          new ConfigService().get<string>('RABBITMQ_PREFETCH_COUNT', '10'),
          10,
        ),
        noAck: false,
      },
    },
  );

  await app.startAllMicroservices();
  console.log(
    'Escrow microservices running:\n' +
      `  • Primary queue: ${ESCROW_QUEUE_NAME}\n` +
      `  • DLQ:           ${ESCROW_QUEUE_DLQ}`,
  );
}

bootstrap();
