import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShipmentsController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';
import { SensorReadingsService } from './sensor-readings.service';
import { ShipmentMilestone } from './entities/shipment-milestone.entity';
import { MilestoneComment } from './entities/milestone-comment.entity';
import { MilestoneVerification } from './entities/milestone-verification.entity';
import { ShipmentSensorReading } from './entities/shipment-sensor-reading.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { QueueModule } from '../queue/queue.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ShipmentMilestone,
      MilestoneComment,
      MilestoneVerification,
      ShipmentSensorReading,
      TradeDeal,
    ]),
    QueueModule,
    NotificationsModule,
  ],
  controllers: [ShipmentsController],
  providers: [ShipmentsService, SensorReadingsService],
  exports: [ShipmentsService],
})
export class ShipmentsModule {}
