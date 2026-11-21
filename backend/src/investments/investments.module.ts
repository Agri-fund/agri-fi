import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvestmentsService } from './investments.service';
import { PortfolioSummaryService } from './portfolio-summary.service';
import { InvestmentsController } from './investments.controller';
import { FeeConfigurationService } from './fee-configuration.service';
import { FeeConfigurationController } from './fee-configuration.controller';
import { CurrencyConverterService } from './currency-converter.service';
import { Investment } from './entities/investment.entity';
import { InvestmentEvent } from './entities/investment-event.entity';
import { SecondaryTrade } from './entities/secondary-trade.entity';
import { SecondaryOrder } from './entities/secondary-order.entity';
import { AutoInvestPlan } from './entities/auto-invest-plan.entity';
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
import { TaxReportService } from './tax-report.service';
import { ReceiptService } from './receipt.service';
import { AccreditationModule } from '../accreditation/accreditation.module';
import { StressTestingModule } from '../stress-testing/stress-testing.module';
import { LiquidityRiskService } from './liquidity-risk.service';
import { LiquidityRiskController } from './liquidity-risk.controller';
import { LiquiditySnapshot } from './entities/liquidity-snapshot.entity';
import { PortfolioVaRService } from './portfolio-var.service';
import { PortfolioVaRLimit } from './entities/portfolio-var-limit.entity';
import { OracleFeed } from '../oracles/entities/oracle-feed.entity';
import { OracleObservation } from '../oracles/entities/oracle-observation.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { KycModule } from '../kyc/kyc.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Investment,
      InvestmentEvent,
      SecondaryTrade,
      SecondaryOrder,
      AutoInvestPlan,
      TradeDeal,
      User,
      FeeConfiguration,
      PaymentDistribution,
      LiquiditySnapshot,
      PortfolioVaRLimit,
      OracleFeed,
      OracleObservation,
    ]),
    StellarModule,
    QueueModule,
    ReferralModule,
    AuthModule,
    AccreditationModule,
    StressTestingModule,
    NotificationsModule,
    KycModule,
  ],
  controllers: [
    InvestmentsController,
    FeeConfigurationController,
    MarketplaceSettlementController,
    AutoInvestController,
    LiquidityRiskController,
  ],
  providers: [
    InvestmentsService,
    PortfolioSummaryService,
    InvestmentEventStore,
    FeeCalculatorService,
    FeeConfigurationService,
    CurrencyConverterService,
    MarketplaceSettlementService,
    TaxReportService,
    ReceiptService,
    InvoiceService,
    SecondaryOrderMatchingService,
    AutoInvestService,
    RiskScoringService,
    LiquidityRiskService,
    PortfolioVaRService,
  ],
  exports: [
    InvestmentsService,
    InvestmentEventStore,
    FeeCalculatorService,
    FeeConfigurationService,
    CurrencyConverterService,
    MarketplaceSettlementService,
    SecondaryOrderMatchingService,
    AutoInvestService,
    LiquidityRiskService,
    PortfolioVaRService,
  ],
})
export class InvestmentsModule {}
