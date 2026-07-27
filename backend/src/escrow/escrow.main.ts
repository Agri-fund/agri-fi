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
  // Create a full NestJS application context so we can mount multiple
  // microservice transports (connectMicroservice is only available on
  // INestApplication, not on INestMicroservice).
  const app = await NestFactory.create(EscrowModule, { logger: ['log', 'warn', 'error'] });
  const config = app.get(ConfigService);
  const rmqUrl = config.get<string>('RABBITMQ_URL', 'amqp://guest:guest@localhost:5672');

  // ── Primary escrow queue — processes deal.delivered events ────────────────
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [rmqUrl],
      queue: ESCROW_QUEUE_NAME,
      queueOptions: dlxQueueOptions(ESCROW_QUEUE_DLX),
      noAck: false,
    },
  });

  // ── DLQ listener — drains permanently-failed messages ────────────────────
  // Messages that exhaust 5 broker-level retries are dead-lettered by RabbitMQ
  // to agric_onchain_escrow_queue.dlx → agric_onchain_escrow_queue.dlq.
  // PayoutDeadLetterConsumer picks them up here and fires ops notifications.
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [rmqUrl],
      queue: ESCROW_QUEUE_DLQ,
      queueOptions: {
        // The DLQ must NOT have its own DLX — failed DLQ messages stay put
        // for manual investigation instead of bouncing further.
        durable: true,
      },
      noAck: false,
    },
  });

  await app.startAllMicroservices();
  console.log(
    'Escrow microservices running:\n' +
      `  • Primary queue: ${ESCROW_QUEUE_NAME}\n` +
      `  • DLQ:           ${ESCROW_QUEUE_DLQ}`,
  );
}

bootstrap();
