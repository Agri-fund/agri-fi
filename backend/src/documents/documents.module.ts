import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { ClamScanService } from './clam-scan.service';
import { StorageModule } from '../storage/storage.module';
import { StellarModule } from '../stellar/stellar.module';
import { TradeDealsModule } from '../trade-deals/trade-deals.module';

@Module({
  imports: [StorageModule, StellarModule, TradeDealsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, ClamScanService],
})
export class DocumentsModule {}
