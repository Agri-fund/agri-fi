import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvestmentsService } from './investments.service';
import { InvestmentsController } from './investments.controller';
import { FeeConfigurationService } from './fee-configuration.service';
import { FeeConfigurationController } from './fee-configuration.controller';
import { CurrencyConverterService } from './currency-converter.service';
import { Investment } from './entities/investment.entity';
import { InvestmentEvent } from './entities/investment-event.entity';
import { SecondaryTrade } from './entities/secondary-trade.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';
import { FeeConfiguration } from '../database/entities/fee-configuration.entity';
import { StellarModule } from '../stellar/stellar.module';
import { QueueModule } from '../queue/queue.module';
import { ReferralModule } from '../auth/referral.module';
import { AuthModule } from '../auth/auth.module';
import { FeeCalculatorService } from './fee-calculator.service';
import { InvestmentEventStore } from './investment-event-store.service';
import { MarketplaceSettlementService } from './marketplace-settlement.service';
import { MarketplaceSettlementController } from './marketplace-settlement.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Investment, InvestmentEvent, SecondaryTrade, TradeDeal, User, FeeConfiguration]),
    StellarModule,
    QueueModule,
    ReferralModule,
    AuthModule,
  ],
  controllers: [InvestmentsController, FeeConfigurationController, MarketplaceSettlementController],
  providers: [
    InvestmentsService,
    InvestmentEventStore,
    FeeCalculatorService,
    FeeConfigurationService,
    CurrencyConverterService,
    MarketplaceSettlementService,
  ],
  exports: [
    InvestmentsService,
    InvestmentEventStore,
    FeeCalculatorService,
    FeeConfigurationService,
    CurrencyConverterService,
    MarketplaceSettlementService,
  ],
})
export class InvestmentsModule {}
