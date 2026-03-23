import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Investment } from '../users/entities/investment.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { InvestmentsController } from './investments.controller';
import { InvestmentsService } from './investments.service';

@Module({
  imports: [TypeOrmModule.forFeature([Investment, TradeDeal])],
  controllers: [InvestmentsController],
  providers: [InvestmentsService],
  exports: [InvestmentsService],
})
export class InvestmentsModule {}
