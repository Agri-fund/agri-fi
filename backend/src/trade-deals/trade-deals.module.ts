import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TradeDealsController } from './trade-deals.controller';
import { TradeDealsService } from './trade-deals.service';
import { TradeDeal } from './entities/trade-deal.entity';
import { Document } from './entities/document.entity';
import { Investment } from '../investments/entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { User } from '../auth/entities/user.entity';
import { StellarModule } from '../stellar/stellar.module';
import { TradeDealsGuard } from './trade-deals.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TradeDeal,
      Document,
      Investment,
      ShipmentMilestone,
      User,
    ]),
    StellarModule,
  ],
  controllers: [TradeDealsController],
  providers: [TradeDealsService, TradeDealsGuard],
  exports: [TradeDealsService],
})
export class TradeDealsModule {}
