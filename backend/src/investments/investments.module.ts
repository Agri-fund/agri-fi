import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvestmentsService } from './investments.service';
import { InvestmentsController } from './investments.controller';
import { FeeConfigurationService } from './fee-configuration.service';
import { FeeConfigurationController } from './fee-configuration.controller';
import { Investment } from './entities/investment.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';
import { FeeConfiguration } from '../database/entities/fee-configuration.entity';
import { StellarModule } from '../stellar/stellar.module';
import { QueueModule } from '../queue/queue.module';
import { FeeCalculatorService } from './fee-calculator.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Investment, TradeDeal, User, FeeConfiguration]),
    StellarModule,
    QueueModule,
  ],
  controllers: [InvestmentsController, FeeConfigurationController],
  providers: [
    InvestmentsService,
    FeeCalculatorService,
    FeeConfigurationService,
  ],
  exports: [InvestmentsService, FeeCalculatorService, FeeConfigurationService],
})
export class InvestmentsModule {}
