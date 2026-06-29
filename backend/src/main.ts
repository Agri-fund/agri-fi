import 'dotenv-vault/config';

// Shim BigInt JSON serialization globally.
// Stellar ledger amounts (stroops, sequence numbers) can exceed Number.MAX_SAFE_INTEGER.
// Without this, JSON.stringify throws: "TypeError: Do not know how to serialize a BigInt".
// This ensures any BigInt that slips through the interceptor is still safely serialized as a string.
if (!(BigInt.prototype as any).toJSON) {
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };
}

import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import {
  ValidationPipe,
  BadRequestException,
  VersioningType,
} from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { applySecurityHeaders } from './common/middleware/security-headers.middleware';
import { CustomLogger } from './common/logger/custom-logger.service';
import { JsonBigIntInterceptor } from './common/interceptors/json-bigint.interceptor';
import * as cookieParser from 'cookie-parser';
import * as csrf from 'csurf';

async function bootstrap() {
  // rawBody: true preserves the unparsed request buffer on req.rawBody,
  // which is required by WebhookSignatureGuard for HMAC verification.
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: new CustomLogger(),
  });

  app.getHttpAdapter().getInstance().disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "https:"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https:"],
      objectSrc: ["'none'"],
    },
  },
  frameguard: { action: 'deny' },
}));

  // DNS rebinding protection: reject requests whose Host header does not match
  // a known domain. /health is exempted so kubelet liveness/readiness probes
  // (which use the pod IP as Host) never get blocked.
  const allowedHosts = (process.env.ALLOWED_HOSTS ?? 'localhost')
    .split(',')
    .map((h) => h.trim().toLowerCase());

  app.use((req: any, res: any, next: () => void) => {
    if (req.path === '/health' || req.path === '/v1/health') {
      return next();
    }
    const host = (req.headers['host'] ?? '').split(':')[0].toLowerCase();
    if (!allowedHosts.includes(host)) {
      res.status(421).end('Misdirected Request');
      return;
    }
    next();
  });

  app.use(applySecurityHeaders);

  // Cookie parser is required by csurf
  app.use(cookieParser());

  // CSRF protection for cookie-based (session) endpoints.
  // JWT-only routes are unaffected; the token is exposed via GET /csrf-token.
  const csrfProtection = csrf({ cookie: { httpOnly: true, sameSite: 'strict' } });
  app.use(csrfProtection);

  // Expose CSRF token so clients can fetch it before mutating requests
  app.use('/csrf-token', (req: any, res: any) => {
    res.json({ csrfToken: req.csrfToken() });
  });

  // Global interceptor to convert BigInt values (Stellar ledger amounts, sequence numbers)
  // to strings in JSON responses, preventing precision loss and serialization errors.
  app.useGlobalInterceptors(new JsonBigIntInterceptor());

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

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Origin not allowed by CORS policy'));
      }
    },
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
    .addTag('sep24', 'SEP-24 interactive deposit and withdrawal')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}

bootstrap();
