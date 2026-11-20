import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum EscrowMigrationStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  ROLLED_BACK = 'rolled_back',
}

export interface EscrowSignerConfig {
  masterKey?: string;
  signers: Array<{
    key: string;
    weight: number;
  }>;
  thresholds: {
    low: number;
    medium: number;
    high: number;
  };
}

@Entity('escrow_migrations')
@Index(['dealId'])
export class EscrowMigration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'deal_id', type: 'uuid' })
  dealId: string;

  @Column({
    type: 'enum',
    enum: EscrowMigrationStatus,
    default: EscrowMigrationStatus.PENDING,
  })
  status: EscrowMigrationStatus;

  @Column({ name: 'transaction_hash', type: 'varchar', length: 64, nullable: true })
  transactionHash: string | null;

  @Column({ name: 'old_signer_config', type: 'jsonb', nullable: true })
  oldSignerConfig: EscrowSignerConfig | null;

  @Column({ name: 'new_signer_config', type: 'jsonb', nullable: true })
  newSignerConfig: EscrowSignerConfig | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}