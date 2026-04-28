import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { EscrowService } from './escrow.service';
import { EscrowConsumer } from './escrow.consumer';
import { PaymentDistribution } from './entities/payment-distribution.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { User } from '../auth/entities/user.entity';
import { StellarModule } from '../stellar/stellar.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forFeature([
      PaymentDistribution,
      TradeDeal,
      Investment,
      User,
    ]),
    StellarModule,
  ],
  controllers: [EscrowConsumer],
  providers: [EscrowService],
  exports: [EscrowService],
})
export class EscrowModule {}
