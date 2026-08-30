import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComplianceReportService } from './compliance-report.service';
import { ComplianceController } from './compliance.controller';
import { ComplianceReport } from './entities/compliance-report.entity';
import { User } from '../auth/entities/user.entity';
import { Investment } from '../investments/entities/investment.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { SystemAuditLog } from '../audit/entities/system-audit-log.entity';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ComplianceReport,
      User,
      Investment,
      TradeDeal,
      SystemAuditLog,
    ]),
    AuditModule,
  ],
  controllers: [ComplianceController],
  providers: [ComplianceReportService],
  exports: [ComplianceReportService],
})
export class ComplianceModule {}
