import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ZkpProof } from './entities/zkp-proof.entity';
import { ZkpCircuitService } from './zkp-circuit.service';
import { ZkpService } from './zkp.service';
import { ZkpController } from './zkp.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([ZkpProof]), AuditModule],
  providers: [ZkpCircuitService, ZkpService],
  controllers: [ZkpController],
  exports: [ZkpService, ZkpCircuitService],
})
export class ZkpModule {}
