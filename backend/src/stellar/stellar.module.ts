import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StellarService } from './stellar.service';
import { StellarController } from './stellar.controller';
import { TransactionLog } from './entities/transaction-log.entity';

@Global()
@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([TransactionLog])],
  controllers: [StellarController],
  providers: [StellarService],
  exports: [StellarService],
})
export class StellarModule {}
