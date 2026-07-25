import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { ClamScanService } from './clam-scan.service';
import { StellarModule } from '../stellar/stellar.module';
import { TradeDealsModule } from '../trade-deals/trade-deals.module';

// StorageModule is intentionally not imported eagerly: it constructs an
// S3Client at module init, which adds to boot time for every request path
// even though document upload is only exercised by this one feature. It's
// lazy-loaded on first upload instead — see DocumentsService.getStorageService().
@Module({
  imports: [StellarModule, TradeDealsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, ClamScanService],
})
export class DocumentsModule {}
