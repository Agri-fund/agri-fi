import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EscrowService } from './escrow.service';
import { EscrowConsumer } from './escrow.consumer';
import { PaymentDistribution } from './entities/payment-distribution.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { User } from '../auth/entities/user.entity';
import { StellarModule } from '../stellar/stellar.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentDistribution,
      TradeDeal,
      Investment,
      User,
    ]),
    StellarModule,
    QueueModule,
  ],
  providers: [EscrowService, EscrowConsumer],
  exports: [EscrowService],
})
export class EscrowModule {}
