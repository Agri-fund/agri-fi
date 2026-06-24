import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StellarService } from './stellar.service';
import { StellarController } from './stellar.controller';
import { TransactionLog } from './entities/transaction-log.entity';
import { PricesService, PRICE_REDIS_CLIENT } from './prices.service';
import { RedisConfig } from '../config/redis.config';
import { StellarHistory } from './entities/stellar-history.entity';
import { StellarArchiverService } from './stellar-archiver.service';
import { StellarMonitorService } from './stellar-monitor.service';

@Global()
@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([TransactionLog, StellarHistory])],
  controllers: [StellarController],
  providers: [
    StellarService,
    PricesService,
    StellarArchiverService,
    StellarMonitorService,
    RedisConfig,
    {
      provide: PRICE_REDIS_CLIENT,
      inject: [RedisConfig],
      useFactory: (redisConfig: RedisConfig) => {
        return redisConfig.createClient();
      },
    },
  ],
  exports: [StellarService, PricesService],
})
export class StellarModule {}
