import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SorobanService } from './soroban.service';
import { SorobanEventIndexer } from './soroban-event-indexer.service';
import { SorobanController } from './soroban.controller';
import { TransactionLog } from '../stellar/entities/transaction-log.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { QueueService } from '../queue/queue.service';

@Global()
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([TransactionLog, ShipmentMilestone, TradeDeal]),
  ],
  controllers: [SorobanController],
  providers: [SorobanService, SorobanEventIndexer, QueueService],
  exports: [SorobanService, SorobanEventIndexer],
})
export class SorobanModule {}
