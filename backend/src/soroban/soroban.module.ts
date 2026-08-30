import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SorobanService } from './soroban.service';
import { SorobanEventIndexer } from './soroban-event-indexer.service';
import { SorobanController } from './soroban.controller';
import { SorobanListenerService } from './soroban-listener.service';
import { SorobanRentService } from './soroban-rent.service';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { TransactionLog } from '../stellar/entities/transaction-log.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { ProcessedSorobanEvent } from './entities/processed-soroban-event.entity';
import { AuditModule } from '../audit/audit.module';

@Global()
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      TradeDeal,
      TransactionLog,
      ShipmentMilestone,
      ProcessedSorobanEvent,
    ]),
    AuditModule,
  ],
  controllers: [SorobanController],
  providers: [
    SorobanService,
    SorobanListenerService,
    SorobanRentService,
    // #791 — was imported but never registered as a provider, so the whole
    // event indexer never actually ran in the live app (onModuleInit never
    // fired). See soroban-event-indexer.service.ts for the event-decoding
    // and idempotency fixes that made this actually safe to turn on.
    SorobanEventIndexer,
  ],
  exports: [SorobanService, SorobanRentService],
})
export class SorobanModule {}
