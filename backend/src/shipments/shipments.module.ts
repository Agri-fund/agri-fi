import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShipmentsService } from './shipments.service';
import { ShipmentsController } from './shipments.controller';
import { ShipmentMilestone } from './entities/shipment-milestone.entity';
import { ShipmentSensorReading } from './entities/shipment-sensor-reading.entity';
import { SensorReadingsService } from './sensor-readings.service';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ShipmentMilestone,
      ShipmentSensorReading,
      TradeDeal,
    ]),
    QueueModule,
  ],
  providers: [ShipmentsService, SensorReadingsService],
  controllers: [ShipmentsController],
})
export class ShipmentsModule {}
