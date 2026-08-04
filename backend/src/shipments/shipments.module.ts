import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShipmentsService } from './shipments.service';
import { ShipmentsController } from './shipments.controller';
import { ShipmentMilestone } from './entities/shipment-milestone.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { QueueModule } from '../queue/queue.module';
import { TradeDealsModule } from '../trade-deals/trade-deals.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ShipmentMilestone, TradeDeal, Investment]),
    QueueModule,
    TradeDealsModule,
  ],
  providers: [ShipmentsService],
  controllers: [ShipmentsController],
})
export class ShipmentsModule {}
