import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseConfig } from './database/database.config';
import { QueueModule } from './queue/queue.module';
import { AuthModule } from './auth/auth.module';
import { StellarModule } from './stellar/stellar.module';
import { ShipmentsModule } from './shipments/shipments.module';
import { TradeDealsModule } from './trade-deals/trade-deals.module';
import { UsersModule } from './users/users.module';
import { InvestmentsModule } from './investments/investments.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useClass: DatabaseConfig,
    }),
    QueueModule,
    AuthModule,
    StellarModule,
    ShipmentsModule,
    TradeDealsModule,
    UsersModule,
    InvestmentsModule,
  ],
})
export class AppModule {}
