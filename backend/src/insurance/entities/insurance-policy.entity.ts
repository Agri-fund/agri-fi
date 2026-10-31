import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { InsuranceQuote } from './insurance-quote.entity';

export type InsurancePolicyStatus = 'anchor_pending' | 'active' | 'expired';

@Entity('insurance_policies')
export class InsurancePolicy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'quote_id', type: 'uuid', unique: true })
  quoteId: string;

  @ManyToOne(() => InsuranceQuote, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'quote_id' })
  quote: InsuranceQuote;

  @Column({ name: 'trade_deal_id', type: 'uuid' })
  tradeDealId: string;

  @Column({ name: 'provider_id', type: 'varchar', length: 64 })
  providerId: string;

  @Column({ name: 'provider_policy_id', type: 'varchar', length: 255 })
  providerPolicyId: string;

  @Column({
    name: 'policy_number',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  policyNumber: string | null;

  @Column({ name: 'coverage_type', type: 'varchar', length: 32 })
  coverageType: string;

  @Column({ name: 'coverage_amount', type: 'numeric', precision: 18, scale: 2 })
  coverageAmount: string;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  currency: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  contract: Record<string, unknown>;

  @Column({ name: 'contract_hash', type: 'varchar', length: 64 })
  contractHash: string;

  @Column({
    name: 'blockchain_tx_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  blockchainTxHash: string | null;

  @Column({ type: 'varchar', length: 24, default: 'anchor_pending' })
  status: InsurancePolicyStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
