import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StellarService, SEQUENCE_REDIS_CLIENT } from './stellar.service';
import { StellarController } from './stellar.controller';
import { TransactionLog } from './entities/transaction-log.entity';
import { PricesService, PRICE_REDIS_CLIENT } from './prices.service';
import { RedisConfig } from '../config/redis.config';
import { StellarHistory } from './entities/stellar-history.entity';
import { StellarArchiverService } from './stellar-archiver.service';
import { StellarMonitorService } from './stellar-monitor.service';
import { KmsService } from '../kms/kms.service';

const redisClientFactory = {
  provide: PRICE_REDIS_CLIENT,
  inject: [RedisConfig],
  useFactory: (redisConfig: RedisConfig) => {
    return redisConfig.createClient();
  },
};

const sequenceRedisClientFactory = {
  provide: SEQUENCE_REDIS_CLIENT,
  inject: [RedisConfig],
  useFactory: (redisConfig: RedisConfig) => {
    return redisConfig.createClient();
  },
};

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
    redisClientFactory,
    sequenceRedisClientFactory,
    KmsService,
    StellarArchiverService,
    StellarMonitorService,
  ],
  exports: [StellarService, PricesService, KmsService],
})
export class StellarModule {}
