import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('compliance_alerts')
export class ComplianceAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'alert_type', length: 100 })
  alertType: string;

  @Column({ name: 'user_id', nullable: true })
  userId: string | null;

  @Column({ name: 'wallet_address', length: 56, nullable: true })
  walletAddress: string | null;

  @Column({ name: 'user_name', length: 255, nullable: true })
  userName: string | null;

  @Column({ name: 'match_reason', type: 'text' })
  matchReason: string;

  @Column({ name: 'risk_score', nullable: true })
  riskScore: number | null;

  @Column({ length: 100, default: 'ofac_screening' })
  source: string;

  @Column({ length: 50, default: 'pending' })
  status: string;

  @Column({ name: 'acknowledged_by', nullable: true })
  acknowledgedBy: string | null;

  @Column({ name: 'acknowledged_at', type: 'timestamptz', nullable: true })
  acknowledgedAt: Date | null;

  @Column({ name: 'dismissed_at', type: 'timestamptz', nullable: true })
  dismissedAt: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
