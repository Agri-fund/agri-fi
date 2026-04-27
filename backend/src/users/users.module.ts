import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { TradeDeal } from './entities/trade-deal.entity';
import { Investment } from './entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { PaymentDistribution } from '../escrow/entities/payment-distribution.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([TradeDeal, Investment, ShipmentMilestone, PaymentDistribution]),
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
