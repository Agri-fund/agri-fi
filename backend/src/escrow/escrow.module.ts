import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EscrowService } from './escrow.service';
import { EscrowConsumer } from './escrow.consumer';
import { EscrowDlqModule } from './escrow-dlq.module';
import { PaymentDistribution } from './entities/payment-distribution.entity';
import { TransactionLog } from './entities/transaction-log.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { User } from '../auth/entities/user.entity';
import { StellarModule } from '../stellar/stellar.module';
import { QueueModule } from '../queue/queue.module';
import { FailedPaymentsService } from './failed-payments.service';
import { EscrowDlqService } from './escrow-dlq.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentDistribution,
      TransactionLog,
      TradeDeal,
      Investment,
      User,
    ]),
    StellarModule,
    QueueModule,
    EscrowDlqModule,
  ],
  controllers: [EscrowConsumer],
  providers: [EscrowService, FailedPaymentsService, EscrowDlqService],
  exports: [EscrowService, FailedPaymentsService, EscrowDlqService],
})
export class EscrowModule {}
