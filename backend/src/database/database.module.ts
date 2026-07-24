import { Module } from '@nestjs/common';
import { TradeDealAuditSubscriber } from './subscribers/trade-deal-audit.subscriber';

@Module({
  providers: [TradeDealAuditSubscriber],
})
export class DatabaseModule {}
