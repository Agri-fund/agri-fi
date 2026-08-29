import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { makeGaugeProvider } from '@willsoto/nestjs-prometheus';
import { TradeDealsController } from './trade-deals.controller';
import { TradeDealsService } from './trade-deals.service';
import { DealCoFarmersService } from './deal-co-farmers.service';
import { DealDeploymentService } from './deal-deployment.service';
import { TradeDeal } from './entities/trade-deal.entity';
import { DealCoFarmer } from './entities/deal-co-farmer.entity';
import { Document } from './entities/document.entity';
import { DealHealthAlert } from './entities/deal-health-alert.entity';
import { Investment } from '../investments/entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { User } from '../auth/entities/user.entity';
import { StellarModule } from '../stellar/stellar.module';
import { QueueModule } from '../queue/queue.module';
import { TradeDealsGuard } from './trade-deals.guard';
import { TradeDealsCronService } from './trade-deals-cron.service';
import { DealFundingAlertService } from './deal-funding-alert.service';
import { DealDigestService } from './deal-digest.service';
import { RiskScoringService } from './risk-scoring.service';
import { DealHealthMonitorService } from './deal-health-monitor.service';
import { ActivityFeedService } from './activity-feed.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';
import { SorobanModule } from '../soroban/soroban.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { SystemAuditLog } from '../audit/entities/system-audit-log.entity';
import { redisCacheStore } from '../config/redis-cache.store';

/**
 * Default TTL for the active-deals marketplace listing cache (30 seconds).
 * Keeps the API snappy while allowing changes to be visible within half a minute.
 */
const DEALS_CACHE_TTL_MS = 30_000;

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TradeDeal,
      Document,
      Investment,
      ShipmentMilestone,
      User,
      DealCoFarmer,
      DealHealthAlert,
      SystemAuditLog,
    ]),
    StellarModule,
    QueueModule,
    NotificationsModule,
    AuditModule,
    SorobanModule,
    WebhooksModule,
    HttpModule,
    /**
     * #743 — Cache active deals list in Redis.
     *
     * When REDIS_URL is set the module uses the Redis-backed store so cache
     * entries are shared across all API replicas and survive process restarts.
     * When REDIS_URL is absent (local dev / CI without Redis) it falls back to
     * the in-memory store so the app still starts cleanly.
     *
     * Cache invalidation: the TradeDealsController calls `cacheManager.reset()`
     * whenever a deal is published, cancelled, or otherwise mutated, so stale
     * listings are evicted immediately on write.
     */
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL', '').trim();

        if (redisUrl) {
          return {
            store: redisCacheStore,
            redisUrl,
            ttl: DEALS_CACHE_TTL_MS,
          };
        }

        // Fallback: plain in-memory cache (no Redis dependency at boot time)
        return { ttl: DEALS_CACHE_TTL_MS };
      },
    }),
  ],
  controllers: [TradeDealsController],
  providers: [
    TradeDealsService,
    DealCoFarmersService,
    DealDeploymentService,
    TradeDealsGuard,
    TradeDealsCronService,
    DealFundingAlertService,
    DealDigestService,
    RiskScoringService,
    DealHealthMonitorService,
    ActivityFeedService,
    makeGaugeProvider({
      name: 'deal_health_alerts_active_total',
      help: 'Total number of active (unresolved) deal health alerts, labelled by alert type.',
      labelNames: ['alertType'],
    }),
  ],
  exports: [TradeDealsService, DealCoFarmersService, DealDigestService, RiskScoringService, ActivityFeedService],
})
export class TradeDealsModule {}
