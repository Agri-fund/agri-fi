import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LetterOfCreditService } from './letter-of-credit.service';
import { LetterOfCreditController } from './letter-of-credit.controller';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';
import { StellarModule } from '../stellar/stellar.module';

@Module({
  imports: [TypeOrmModule.forFeature([TradeDeal, User]), StellarModule],
  controllers: [LetterOfCreditController],
  providers: [LetterOfCreditService],
  exports: [LetterOfCreditService],
})
export class LetterOfCreditModule {}
