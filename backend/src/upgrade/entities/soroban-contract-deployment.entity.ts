import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

export type DeploymentStatus =
  'active' | 'superseded' | 'rolled_back' | 'failed';

@Entity('soroban_contract_deployments')
export class SorobanContractDeployment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'contract_name' })
  @ApiProperty({ example: 'farm_campaign' })
  contractName: string;

  @Column({ name: 'network_passphrase' })
  networkPassphrase: string;

  @Column({ name: 'contract_id' })
  contractId: string;

  @Column({ name: 'wasm_hash' })
  wasmHash: string;

  @Column({ name: 'previous_wasm_hash', nullable: true })
  previousWasmHash: string | null;

  @Column({ name: 'deployed_at', type: 'timestamptz' })
  deployedAt: Date;

  @Column({ name: 'deployed_by', nullable: true })
  deployedBy: string | null;

  @Column({ type: 'varchar', length: 32, default: 'active' })
  status: DeploymentStatus;

  @Column({ name: 'upgrade_plan_id', nullable: true })
  upgradePlanId: string | null;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @Column({ name: 'smoke_test_passed', nullable: true })
  smokeTestPassed: boolean | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

export type UpgradePlanStatus =
  | 'planned'
  | 'pending_approval'
  | 'approved'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'rolled_back';

@Entity('soroban_upgrade_plans')
export class SorobanUpgradePlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'contract_name' })
  contractName: string;

  @Column({ name: 'network_passphrase' })
  networkPassphrase: string;

  @Column({ name: 'contract_id' })
  contractId: string;

  @Column({ name: 'new_wasm_hash' })
  newWasmHash: string;

  @Column({ name: 'previous_wasm_hash' })
  previousWasmHash: string;

  @Column({ name: 'new_wasm_path' })
  newWasmPath: string;

  @Column({ type: 'varchar', length: 32, default: 'planned' })
  status: UpgradePlanStatus;

  @Column({ name: 'planned_by' })
  plannedBy: string;

  @Column({ name: 'executed_at', type: 'timestamptz', nullable: true })
  executedAt: Date | null;

  @Column({ name: 'state_snapshot', type: 'jsonb', nullable: true })
  stateSnapshot: Record<string, unknown> | null;

  @Column({ name: 'testnet_validated', default: false })
  testnetValidated: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('soroban_upgrade_approvals')
export class SorobanUpgradeApproval {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'upgrade_plan_id' })
  upgradePlanId: string;

  @Column({ name: 'admin_id' })
  adminId: string;

  @Column()
  signature: string;

  @Column({ name: 'approved_at', type: 'timestamptz' })
  approvedAt: Date;
}
