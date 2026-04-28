import { NestFactory } from '@nestjs/core';
import { EscrowModule } from './escrow.module';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';

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
        queue: 'agric_onchain_escrow_queue',
        queueOptions: { durable: true },
      },
    },
  );

  await app.listen();
  console.log(
    'Escrow microservice is running on dedicated queue: agric_onchain_escrow_queue',
  );
}

bootstrap();
