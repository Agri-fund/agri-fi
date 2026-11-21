import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EscrowService } from './escrow.service';
import { EscrowConsumer } from './escrow.consumer';
import { EscrowDlqModule } from './escrow-dlq.module';
import { PaymentDistribution } from './entities/payment-distribution.entity';
import { TransactionLog } from '../database/entities/transaction-log.entity';
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
import { ESCROW_METRICS_PROVIDERS } from './escrow-metrics.providers';
import { EscrowFailedPaymentsMetrics } from './escrow-failed-payments.metrics';
import { NotificationsModule } from '../notifications/notifications.module';
import { EscrowMigration } from './entities/escrow-migration.entity';
import { EscrowMigrationService } from './escrow-migration.service';
import { KycModule } from '../kyc/kyc.module';
import { EscrowMigrationController } from './escrow-migration.controller';

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
      EscrowMigration,
    ]),
    StellarModule,
    QueueModule,
    EscrowDlqModule,
    NotificationsModule,
    KycModule,
  ],
  controllers: [EscrowConsumer, EscrowMigrationController],
  providers: [
    EscrowService,
    FailedPaymentsService,
    EscrowDlqService,
    MilestonePartialReleaseService,
    EscrowMigrationService,
    EscrowFailedPaymentsMetrics,
    ...ESCROW_METRICS_PROVIDERS,
  ],
  exports: [
    EscrowService,
    FailedPaymentsService,
    EscrowDlqService,
    MilestonePartialReleaseService,
    EscrowMigrationService,
  ],
})
export class EscrowModule {}
