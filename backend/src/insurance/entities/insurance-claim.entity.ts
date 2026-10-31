import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { InsurancePolicy } from './insurance-policy.entity';

export type InsuranceClaimStatus =
  | 'submitted'
  | 'submission_failed'
  | 'approved'
  | 'rejected'
  | 'payout_pending'
  | 'payout_processing'
  | 'paid';

@Entity('insurance_claims')
@Index(['policyId', 'eventId'], { unique: true })
@Index(['providerId', 'status', 'createdAt'])
export class InsuranceClaim {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'policy_id', type: 'uuid' })
  policyId: string;

  @ManyToOne(() => InsurancePolicy, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'policy_id' })
  policy: InsurancePolicy;

  @Column({ name: 'trade_deal_id', type: 'uuid' })
  tradeDealId: string;

  @Column({ name: 'provider_id', type: 'varchar', length: 64 })
  providerId: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId: string;

  @Column({ name: 'event_type', type: 'varchar', length: 32 })
  eventType: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  amount: string;

  @Column({
    name: 'approved_amount',
    type: 'numeric',
    precision: 18,
    scale: 2,
    nullable: true,
  })
  approvedAmount: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  evidence: string[];

  @Column({
    name: 'provider_claim_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  providerClaimId: string | null;

  @Column({
    name: 'provider_payout_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  providerPayoutId: string | null;

  @Column({
    name: 'payout_tx_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  payoutTxHash: string | null;

  @Column({ type: 'varchar', length: 24, default: 'submitted' })
  status: InsuranceClaimStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
