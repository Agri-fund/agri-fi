import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User } from '../auth/entities/user.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { PaymentDistribution } from '../escrow/entities/payment-distribution.entity';
import { KycSubmission } from '../auth/entities/kyc-submission.entity';
import { Document } from '../trade-deals/entities/document.entity';
import { AuditLog } from '../database/entities/audit-log.entity';
import { TradeDealsModule } from '../trade-deals/trade-deals.module';

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
    ]),
    TradeDealsModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
