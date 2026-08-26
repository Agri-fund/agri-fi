import { Module, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TradeDealAuditSubscriber } from './subscribers/trade-deal-audit.subscriber';
import { DatabaseConfig } from './database.config';

/**
 * DatabaseModule bootstraps TypeORM, registers the audit subscriber, and
 * wires the live DataSource into DatabaseConfig so the connection-pool
 * monitor can run pg_stat_activity queries after the app has booted (#742).
 */
@Module({
  providers: [TradeDealAuditSubscriber, DatabaseConfig],
  exports: [DatabaseConfig],
})
export class DatabaseModule implements OnModuleInit {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly dbConfig: DatabaseConfig,
  ) {}

  onModuleInit(): void {
    // Hand the initialised DataSource to DatabaseConfig so its
    // onApplicationBootstrap hook can query pg_stat_activity.
    this.dbConfig.setDataSource(this.dataSource);
  }
}
