import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StellarService, SEQUENCE_REDIS_CLIENT } from './stellar.service';
import { StellarController } from './stellar.controller';
import { Sep12Controller } from './sep12.controller';
import { Sep12Service } from './sep12.service';
import { Sep24Controller } from './sep24.controller';
import { Sep24Service } from './sep24.service';
import { TransactionLog } from './entities/transaction-log.entity';
import { Sep24Transaction } from './entities/sep24-transaction.entity';
import { PricesService, PRICE_REDIS_CLIENT } from './prices.service';
import { RedisConfig } from '../config/redis.config';
import { StellarHistory } from './entities/stellar-history.entity';
import { StellarArchiverService } from './stellar-archiver.service';
import { StellarMonitorService } from './stellar-monitor.service';
import { KmsService } from '../kms/kms.service';
import { User } from '../auth/entities/user.entity';
import { KycSubmission } from '../auth/entities/kyc-submission.entity';

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
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      TransactionLog,
      StellarHistory,
      Sep24Transaction,
      User,
      KycSubmission,
    ]),
  ],
  controllers: [StellarController, Sep24Controller, Sep12Controller],
  providers: [
    StellarService,
    Sep12Service,
    Sep24Service,
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
  exports: [StellarService, Sep24Service, PricesService, KmsService],
})
export class StellarModule {}
