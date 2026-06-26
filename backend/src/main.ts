import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { applySecurityHeaders } from './common/middleware/security-headers.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(applySecurityHeaders);

  // Connect the hybrid RMQ consumer with prefetchCount=1 so Stellar operations
  // for a single escrow account execute sequentially and never race on sequence numbers.
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672'],
      queue: 'agric_onchain_queue',
      queueOptions: { durable: true },
      prefetchCount: 1,
      noAck: false,
    },
  });

  await app.startAllMicroservices();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => {
        const walletError = errors.find(
          (e) =>
            e.property === 'walletAddress' &&
            e.constraints?.['isStellarPublicKey'],
        );
        if (walletError) {
          throw new BadRequestException({
            code: 'INVALID_WALLET_ADDRESS',
            message: 'walletAddress must be a valid Stellar public key.',
          });
        }
        throw new BadRequestException(errors);
      },
    }),
  );

  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? [
      'http://localhost:3000',
    ],
    credentials: true,
  });

  // Use the fully-configured setupSwagger (includes production Basic-Auth guard)
  // instead of the previous inline setup that had no authentication.
  setupSwagger(app);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Agric-onchain backend running on port ${port}`);
}

/**
 * Configure Swagger UI with production Basic-Auth protection.
 *
 * Required env vars when NODE_ENV=production:
 *   SWAGGER_USER  — HTTP Basic Auth username (default: admin)
 *   SWAGGER_PASS  — HTTP Basic Auth password (no default; required in prod)
 */
function setupSwagger(app: any) {
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd) {
    // Protect Swagger UI with HTTP Basic Auth in production
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const basicAuth = require('express-basic-auth');
    const user = process.env.SWAGGER_USER ?? 'admin';
    const pass = process.env.SWAGGER_PASS;
    if (!pass) {
      throw new Error(
        'SWAGGER_PASS must be set in production to protect the API docs.',
      );
    }
    app.use(
      '/api/docs',
      basicAuth({ users: { [user]: pass }, challenge: true }),
    );
  }

  const config = new DocumentBuilder()
    .setTitle('Agri-Fi API')
    .setDescription(
      'REST API for the Agri-Fi agricultural trade finance platform. ' +
        'Farmers list produce, traders create deals, investors fund them via Stellar escrow.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'jwt',
    )
    .addTag('auth', 'Registration, login, KYC, and wallet linking')
    .addTag('trade-deals', 'Create and browse agricultural trade deals')
    .addTag('investments', 'Fund trade deals and manage investments')
    .addTag('shipments', 'Record and query shipment milestones')
    .addTag('documents', 'Upload trade documents to IPFS')
    .addTag('users', 'User dashboard data')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}

bootstrap();
