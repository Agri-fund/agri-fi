import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { ClsModule, ClsMiddleware } from 'nestjs-cls';
import { DatabaseConfig } from './database/database.config';
import { AuthModule } from './auth/auth.module';
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
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { loggingConfig } from './common/logging/logging.config';
import { HealthModule } from './health/health.module';
import { TerminusModule } from '@nestjs/terminus';
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    // Register ClsModule globally — no auto-mount; we mount manually below
    // to guarantee ordering: ClsMiddleware runs before CorrelationIdMiddleware
    ClsModule.forRoot({ global: true }),
    ThrottlerModule.forRoot([
      {
        ttl: parseInt(process.env.RATE_LIMIT_TTL || '60000'),
        limit: parseInt(process.env.RATE_LIMIT_GLOBAL || '100'),
      },
    ]),
    LoggerModule.forRoot(loggingConfig),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useClass: DatabaseConfig,
    }),
    AuthModule,
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
    HealthModule,
    TerminusModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // ClsMiddleware MUST run first to establish the async context,
    // then CorrelationIdMiddleware can safely call cls.set()
    consumer
      .apply(ClsMiddleware, CorrelationIdMiddleware)
      .forRoutes('*');
  }
}
