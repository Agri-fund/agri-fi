import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SorobanService } from './soroban.service';
import { SorobanEventIndexer } from './soroban-event-indexer.service';
import { SorobanController } from './soroban.controller';
import { SorobanListenerService } from './soroban-listener.service';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';

@Global()
@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([TradeDeal])],
  controllers: [SorobanController],
  providers: [SorobanService, SorobanListenerService],
  exports: [SorobanService],
})
export class SorobanModule {}
