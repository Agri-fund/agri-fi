import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersController } from './users.controller';
import { PublicUsersController } from './public-users.controller';
import { EmailPreferencesController } from './email-preferences.controller';
import { UsersService } from './users.service';
import { User } from '../auth/entities/user.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { PaymentDistribution } from '../escrow/entities/payment-distribution.entity';
import { KycSubmission } from '../auth/entities/kyc-submission.entity';
import { Document } from '../trade-deals/entities/document.entity';
import { AuditLog } from '../database/entities/audit-log.entity';
import { FarmerCreditScoreHistory } from './entities/farmer-credit-score-history.entity';
import { FarmerCreditScoringService } from './farmer-credit-scoring.service';
import { TradeDealsModule } from '../trade-deals/trade-deals.module';
import { redisCacheStore } from '../config/redis-cache.store';

/** TTL for farmer reputation score cache entries (15 minutes in milliseconds). */
const REPUTATION_CACHE_TTL_MS = 15 * 60 * 1_000;

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      TradeDeal,
      Investment,
      ShipmentMilestone,
      PaymentDistribution,
      KycSubmission,
      Document,
      AuditLog,
      FarmerCreditScoreHistory,
    ]),
    TradeDealsModule,
    CacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL', '').trim();
        if (redisUrl) {
          return {
            store: redisCacheStore,
            redisUrl,
            ttl: REPUTATION_CACHE_TTL_MS,
          };
        }
        return { ttl: REPUTATION_CACHE_TTL_MS };
      },
    }),
  ],
  controllers: [UsersController, PublicUsersController, EmailPreferencesController],
  providers: [UsersService, FarmerCreditScoringService],
  exports: [UsersService, FarmerCreditScoringService],
})
export class UsersModule {}
