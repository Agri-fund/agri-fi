import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShipmentMilestone } from './entities/shipment-milestone.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { ShipmentsService } from './shipments.service';
import { ShipmentsController } from './shipments.controller';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ShipmentMilestone, TradeDeal]),
    QueueModule,
  ],
  providers: [ShipmentsService],
  controllers: [ShipmentsController],
})
export class ShipmentsModule {}
