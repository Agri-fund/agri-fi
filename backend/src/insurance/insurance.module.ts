import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StellarModule } from '../stellar/stellar.module';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';
import { InsuranceClaim } from './entities/insurance-claim.entity';
import { InsurancePolicy } from './entities/insurance-policy.entity';
import { InsuranceQuote } from './entities/insurance-quote.entity';
import { InsuranceController } from './insurance.controller';
import { InsuranceService } from './insurance.service';

@Module({
  imports: [
    ConfigModule,
    HttpModule,
    StellarModule,
    TypeOrmModule.forFeature([
      TradeDeal,
      User,
      InsuranceQuote,
      InsurancePolicy,
      InsuranceClaim,
    ]),
  ],
  controllers: [InsuranceController],
  providers: [InsuranceService],
  exports: [InsuranceService],
})
export class InsuranceModule {}
