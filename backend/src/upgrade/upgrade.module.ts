import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  SorobanContractDeployment,
  SorobanUpgradePlan,
  SorobanUpgradeApproval,
} from './entities/soroban-contract-deployment.entity';
import { UpgradeService } from './upgrade.service';
import { UpgradeController } from './upgrade.controller';
import { SorobanModule } from '../soroban/soroban.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SorobanContractDeployment,
      SorobanUpgradePlan,
      SorobanUpgradeApproval,
    ]),
    SorobanModule,
    AuditModule,
  ],
  controllers: [UpgradeController],
  providers: [UpgradeService],
  exports: [UpgradeService],
})
export class UpgradeModule {}
