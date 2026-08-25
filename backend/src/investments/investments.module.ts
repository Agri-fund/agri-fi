import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvestmentsService } from './investments.service';
import { InvestmentsController } from './investments.controller';
import { FeeConfigurationService } from './fee-configuration.service';
import { FeeConfigurationController } from './fee-configuration.controller';
import { CurrencyConverterService } from './currency-converter.service';
import { Investment } from './entities/investment.entity';
import { InvestmentEvent } from './entities/investment-event.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';
import { FeeConfiguration } from '../database/entities/fee-configuration.entity';
import { StellarModule } from '../stellar/stellar.module';
import { QueueModule } from '../queue/queue.module';
import { ReferralModule } from '../auth/referral.module';
import { FeeCalculatorService } from './fee-calculator.service';
import { InvestmentEventStore } from './investment-event-store.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Investment, InvestmentEvent, TradeDeal, User, FeeConfiguration]),
    StellarModule,
    QueueModule,
    ReferralModule,
  ],
  controllers: [InvestmentsController, FeeConfigurationController],
  providers: [
    InvestmentsService,
    InvestmentEventStore,
    FeeCalculatorService,
    FeeConfigurationService,
    CurrencyConverterService,
  ],
  exports: [
    InvestmentsService,
    InvestmentEventStore,
    FeeCalculatorService,
    FeeConfigurationService,
    CurrencyConverterService,
  ],
})
export class InvestmentsModule {}
