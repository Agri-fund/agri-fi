import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { TradeDeal } from './entities/trade-deal.entity';
import { Investment } from './entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { Document } from '../trade-deals/entities/document.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([TradeDeal, Investment, ShipmentMilestone, Document]),
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
