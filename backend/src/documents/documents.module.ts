import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { SignatureRequestService } from './signature-request.service';
import { WatermarkService } from './watermark.service';
import { ClamScanService } from './clam-scan.service';
import { SignatureRequest } from './entities/signature-request.entity';
import { Document } from '../trade-deals/entities/document.entity';
import { User } from '../auth/entities/user.entity';
import { StellarModule } from '../stellar/stellar.module';
import { TradeDealsModule } from '../trade-deals/trade-deals.module';
import { SettlementModule } from '../settlement/settlement.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SIGNING_JWT_MODULE } from './documents.constants';

// StorageModule is intentionally not imported eagerly: it constructs an
// S3Client at module init, which adds to boot time for every request path
// even though document upload is only exercised by this one feature. It's
// lazy-loaded on first upload instead — see DocumentsService.getStorageService().
@Module({
  imports: [
    TypeOrmModule.forFeature([SignatureRequest, Document, User]),
    ConfigModule,
    NotificationsModule,
    TradeDealsModule,
    StellarModule,
    SettlementModule,
    AuditModule,
  ],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    ClamScanService,
    WatermarkService,
    SignatureRequestService,
    {
      provide: SIGNING_JWT_MODULE,
      useFactory: (config: ConfigService) => {
        return new JwtService({
          secret:
            config.get<string>('SIGNING_TOKEN_SECRET') ||
            config.get<string>('JWT_SECRET'),
          signOptions: {
            expiresIn: config.get<string>(
              'SIGNING_TOKEN_EXPIRES_IN',
              '7d',
            ),
          },
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [DocumentsService, WatermarkService, SignatureRequestService],
})
export class DocumentsModule {}
