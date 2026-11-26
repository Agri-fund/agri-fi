import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dispute } from './entities/dispute.entity';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { User } from '../auth/entities/user.entity';
import { DocumentsModule } from '../documents/documents.module';
import { EscrowModule } from '../escrow/escrow.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Dispute,
      TradeDeal,
      Investment,
      ShipmentMilestone,
      User,
    ]),
    DocumentsModule,
    EscrowModule,
    AuditModule,
    NotificationsModule,
    QueueModule,
  ],
  controllers: [DisputesController],
  providers: [DisputesService],
  exports: [DisputesService],
})
export class DisputesModule {}
