import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PublicApiController } from './public-api.controller';
import { AuthModule } from '../auth/auth.module';
import { TradeDealsModule } from '../trade-deals/trade-deals.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ApiKey } from '../auth/entities/api-key.entity';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { ApiKeyThrottlerGuard } from '../common/throttler/api-key-throttler.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApiKey]),
    AuthModule,
    TradeDealsModule,
    WebhooksModule,
  ],
  controllers: [PublicApiController],
  providers: [ApiKeyGuard, ApiKeyThrottlerGuard],
  exports: [ApiKeyGuard, ApiKeyThrottlerGuard],
})
export class PublicApiModule {}
