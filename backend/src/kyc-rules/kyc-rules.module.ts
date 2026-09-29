import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KycJurisdictionRule } from './entities/kyc-jurisdiction-rule.entity';
import { KycRulesService } from './kyc-rules.service';
import { KycRulesController } from './kyc-rules.controller';
import { AdminKycRulesController } from './admin-kyc-rules.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([KycJurisdictionRule]), AuditModule],
  controllers: [KycRulesController, AdminKycRulesController],
  providers: [KycRulesService],
  exports: [KycRulesService],
})
export class KycRulesModule {}
