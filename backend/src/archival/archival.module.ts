import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { makeCounterProvider } from '@willsoto/nestjs-prometheus';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { TradeDealArchive } from './entities/trade-deal-archive.entity';
import { InvestmentArchive } from './entities/investment-archive.entity';
import { ShipmentMilestoneArchive } from './entities/shipment-milestone-archive.entity';
import { ArchivalService } from './archival.service';
import { ArchivalCronService } from './archival-cron.service';
import { AdminArchiveController } from './admin-archive.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TradeDeal,
      Investment,
      ShipmentMilestone,
      TradeDealArchive,
      InvestmentArchive,
      ShipmentMilestoneArchive,
    ]),
  ],
  controllers: [AdminArchiveController],
  providers: [
    ArchivalService,
    ArchivalCronService,
    makeCounterProvider({
      name: 'archival_records_archived_total',
      help: 'Total number of records moved to archive tables',
      labelNames: ['table'],
    }),
    makeCounterProvider({
      name: 'archival_runs_total',
      help: 'Total number of archival runs',
      labelNames: ['status'],
    }),
  ],
  exports: [ArchivalService],
})
export class ArchivalModule {}
