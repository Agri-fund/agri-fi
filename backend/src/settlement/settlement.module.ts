import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettlementService } from './settlement.service';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Document } from '../trade-deals/entities/document.entity';
import { SorobanModule } from '../soroban/soroban.module';
import { StellarModule } from '../stellar/stellar.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TradeDeal, Document]),
    SorobanModule,
    StellarModule,
    NotificationsModule,
  ],
  providers: [SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}
