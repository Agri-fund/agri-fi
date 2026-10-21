import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Investment } from '../investments/entities/investment.entity';
import { PaymentDistribution } from '../escrow/entities/payment-distribution.entity';
import { TransactionLog } from '../database/entities/transaction-log.entity';
import { ComplianceAlert } from '../database/entities/compliance-alert.entity';
import { User } from '../auth/entities/user.entity';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { AmlMonitoringRule } from './entities/aml-monitoring-rule.entity';
import { AmlAlert } from './entities/aml-alert.entity';
import { AmlCase } from './entities/aml-case.entity';
import { AmlMonitoringRun } from './entities/aml-monitoring-run.entity';
import { AmlScreeningResult } from './entities/aml-screening-result.entity';
import { AmlDispositionFeedback } from './entities/aml-disposition-feedback.entity';
import { AmlSarReport } from './entities/aml-sar-report.entity';
import { AmlRegulatorySubmission } from './entities/aml-regulatory-submission.entity';
import { SanctionsListEntry } from './entities/sanctions-list-entry.entity';
import { AmlRulesService } from './aml-rules.service';
import { AmlCaseService } from './aml-case.service';
import { TransactionMonitoringService } from './transaction-monitoring.service';
import { SanctionsListService } from './sanctions-list.service';
import { SanctionsScreeningService } from './sanctions-screening.service';
import { SarGenerationService } from './sar-generation.service';
import { RegulatoryReportingService } from './regulatory-reporting.service';
import { AmlMonitoringCronService } from './aml-monitoring-cron.service';
import { AmlMonitoringController } from './aml-monitoring.controller';

/**
 * AML / KYC transaction monitoring (#1217). `ComplianceModule` is imported for
 * the rule engine the sweep cross-checks against; `AuthModule` supplies the
 * optional wallet KYT screener and the JWT strategy the admin routes use.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AmlMonitoringRule,
      AmlAlert,
      AmlCase,
      AmlMonitoringRun,
      AmlScreeningResult,
      AmlDispositionFeedback,
      AmlSarReport,
      AmlRegulatorySubmission,
      SanctionsListEntry,
      User,
      Investment,
      PaymentDistribution,
      TransactionLog,
      ComplianceAlert,
    ]),
    AuthModule,
    AuditModule,
    ComplianceModule,
  ],
  controllers: [AmlMonitoringController],
  providers: [
    AmlRulesService,
    AmlCaseService,
    TransactionMonitoringService,
    SanctionsListService,
    SanctionsScreeningService,
    SarGenerationService,
    RegulatoryReportingService,
    AmlMonitoringCronService,
  ],
  exports: [
    AmlRulesService,
    AmlCaseService,
    TransactionMonitoringService,
    SanctionsListService,
    SanctionsScreeningService,
    SarGenerationService,
    RegulatoryReportingService,
  ],
})
export class AmlMonitoringModule {}
