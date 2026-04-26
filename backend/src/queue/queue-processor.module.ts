import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueueProcessor } from './queue.processor';
import { TradeDealsModule } from '../trade-deals/trade-deals.module';
import { StellarModule } from '../stellar/stellar.module';
import { Investment } from '../investments/entities/investment.entity';
import { User } from '../auth/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Investment, User]),
    TradeDealsModule,
    StellarModule,
    NotificationsModule,
  ],
  providers: [QueueProcessor],
})
export class QueueProcessorModule {}
