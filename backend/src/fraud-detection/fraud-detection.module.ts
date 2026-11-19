import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  FraudDetectionService,
  FederatedLearningService,
} from './fraud-detection.service';
import { Investment } from '../investments/entities/investment.entity';
import { User } from '../auth/entities/user.entity';
import { SystemAuditLog } from '../audit/entities/system-audit-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Investment, User, SystemAuditLog])],
  providers: [FraudDetectionService, FederatedLearningService],
  exports: [FraudDetectionService, FederatedLearningService],
})
export class FraudDetectionModule {}
