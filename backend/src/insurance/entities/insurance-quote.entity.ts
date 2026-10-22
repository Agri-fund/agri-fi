import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type InsuranceCoverageType =
  'crop_failure' | 'shipment_damage' | 'price_fluctuation';

export type InsuranceQuoteStatus = 'offered' | 'issuing' | 'issued';

@Entity('insurance_quotes')
@Index(['tradeDealId', 'status'])
@Index(['providerId', 'providerQuoteId'], { unique: true })
export class InsuranceQuote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'trade_deal_id', type: 'uuid' })
  tradeDealId: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @Column({ name: 'provider_id', type: 'varchar', length: 64 })
  providerId: string;

  @Column({ name: 'provider_quote_id', type: 'varchar', length: 255 })
  providerQuoteId: string;

  @Column({ name: 'coverage_type', type: 'varchar', length: 32 })
  coverageType: InsuranceCoverageType;

  @Column({ name: 'coverage_amount', type: 'numeric', precision: 18, scale: 2 })
  coverageAmount: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  premium: string;

  @Column({ type: 'varchar', length: 3, default: 'USD' })
  currency: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  terms: Record<string, unknown>;

  @Column({ name: 'risk_score', type: 'numeric', precision: 5, scale: 2 })
  riskScore: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'varchar', length: 16, default: 'offered' })
  status: InsuranceQuoteStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
