import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors();

  setupSwagger(app);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Agric-onchain backend running on port ${port}`);
}

function setupSwagger(app: any) {
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd) {
    // Protect Swagger UI with HTTP Basic Auth in production
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const basicAuth = require('express-basic-auth');
    const user = process.env.SWAGGER_USER ?? 'admin';
    const pass = process.env.SWAGGER_PASS ?? 'changeme';
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
