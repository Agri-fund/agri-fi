import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { ClsModule, ClsMiddleware } from 'nestjs-cls';
import { DatabaseConfig } from './database/database.config';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { ReferralModule } from './auth/referral.module';
import { StellarModule } from './stellar/stellar.module';
import { ShipmentsModule } from './shipments/shipments.module';
import { TradeDealsModule } from './trade-deals/trade-deals.module';
import { UsersModule } from './users/users.module';
import { InvestmentsModule } from './investments/investments.module';
import { EscrowModule } from './escrow/escrow.module';
import { StorageModule } from './storage/storage.module';
import { DocumentsModule } from './documents/documents.module';
import { NotificationsModule } from './notifications/notifications.module';
import { QueueProcessorModule } from './queue/queue-processor.module';
import { OutboxModule } from './outbox/outbox.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { HttpLoggerMiddleware } from './common/middleware/http-logger.middleware';
import { loggingConfig } from './common/logging/logging.config';
import { HealthModule } from './health/health.module';
import { TerminusModule } from '@nestjs/terminus';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { SorobanModule } from './soroban/soroban.module';
import { MetricsModule } from './metrics/metrics.module';
import { validateEnvironment } from './config/env.validation';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER } from '@nestjs/core';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AuditModule } from './audit/audit.module';

import { AchievementModule } from './achievements/achievement.module';
import { EmailSequenceModule } from './email-sequence/email-sequence.module';
import { ArchivalModule } from './archival/archival.module';

@Module({
  controllers: [AppController],
  imports: [
    // Register ClsModule globally — no auto-mount; we mount manually below
    // to guarantee ordering: ClsMiddleware runs before CorrelationIdMiddleware
    ClsModule.forRoot({ global: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: parseInt(process.env.RATE_LIMIT_TTL || '60000'),
        limit: parseInt(process.env.RATE_LIMIT_GLOBAL || '100'),
      },
      {
        name: 'login',
        ttl: 60000,
        limit: 5,
      },
      {
        name: 'kyc',
        ttl: 60000,
        limit: 3,
      },
      {
        name: 'marketplace',
        ttl: 60000,
        limit: 60,
      },
    ]),
    LoggerModule.forRoot(loggingConfig),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnvironment,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useClass: DatabaseConfig,
    }),
    DatabaseModule,
    AuthModule,
    ReferralModule,
    StellarModule,
    ShipmentsModule,
    TradeDealsModule,
    UsersModule,
    InvestmentsModule,
    EscrowModule,
    StorageModule,
    DocumentsModule,
    NotificationsModule,
    QueueProcessorModule,
    OutboxModule,
    HealthModule,
    TerminusModule,
    SorobanModule,
    MetricsModule,
    AuditModule,
    AchievementModule,
    EmailSequenceModule,
    ArchivalModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // HttpLoggerMiddleware runs first so its timer covers the full request lifecycle.
    // ClsMiddleware MUST run before CorrelationIdMiddleware so it can safely call cls.set()
    consumer
      .apply(HttpLoggerMiddleware, ClsMiddleware, CorrelationIdMiddleware)
      .forRoutes('{*splat}');
  }
}
