import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EscrowService } from './escrow.service';
import { EscrowConsumer } from './escrow.consumer';
import { EscrowDlqModule } from './escrow-dlq.module';
import { PaymentDistribution } from './entities/payment-distribution.entity';
import { TransactionLog } from './entities/transaction-log.entity';
import { MilestoneReleaseRecord } from './entities/milestone-release-record.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { User } from '../auth/entities/user.entity';
import { StellarModule } from '../stellar/stellar.module';
import { QueueModule } from '../queue/queue.module';
import { FailedPaymentsService } from './failed-payments.service';
import { EscrowDlqService } from './escrow-dlq.service';
import { MilestonePartialReleaseService } from './milestone-partial-release.service';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentDistribution,
      TransactionLog,
      MilestoneReleaseRecord,
      TradeDeal,
      Investment,
      User,
      ShipmentMilestone,
    ]),
    StellarModule,
    QueueModule,
    EscrowDlqModule,
  ],
  controllers: [EscrowConsumer],
  providers: [
    EscrowService,
    FailedPaymentsService,
    EscrowDlqService,
    MilestonePartialReleaseService,
  ],
  exports: [
    EscrowService,
    FailedPaymentsService,
    EscrowDlqService,
    MilestonePartialReleaseService,
  ],
})
export class EscrowModule {}
