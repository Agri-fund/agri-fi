import { Module, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TradeDealAuditSubscriber } from './subscribers/trade-deal-audit.subscriber';
import { DatabaseConfig } from './database.config';
import { ReplicaManagerService } from './replica-manager.service';

/**
 * Ordered list of migrations that must run during deployment.
 * Each entry is a migration class name; TypeORM resolves them from the
 * configured migrations glob. Keeping the explicit order here guarantees
 * that the price-alert (#1417) and watchlist (#1419) migrations run after
 * the core schema migrations they depend on.
 */
export const MIGRATION_ORDER: string[] = [
  'InitialSchema1700000000000',
  'AddTradeDealAudit1700000001000',
  'AddPriceAlerts1700000002000',
  'AddWatchlist1700000003000',
];

/**
 * DatabaseModule bootstraps TypeORM, registers the audit subscriber, and
 * wires the live DataSource into DatabaseConfig so the connection-pool
 * monitor can sample the driver's native pool after the app has booted (#742).
 */
@Module({
  providers: [TradeDealAuditSubscriber, DatabaseConfig, ReplicaManagerService],
  exports: [DatabaseConfig, ReplicaManagerService],
})
export class DatabaseModule implements OnModuleInit {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly dbConfig: DatabaseConfig,
  ) {}

  onModuleInit(): void {
    // Hand the initialised DataSource to DatabaseConfig so its
    // onApplicationBootstrap hook can monitor the native connection pool.
    this.dbConfig.setDataSource(this.dataSource);
  }
}
</｜｜DSML｜｜ parameter>