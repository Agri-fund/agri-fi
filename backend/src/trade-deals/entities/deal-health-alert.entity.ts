import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { TradeDeal } from './trade-deal.entity';

export type DealHealthAlertType =
  | 'funding_below_threshold'
  | 'no_recent_investment'
  | 'shipment_overdue'
  | 'sensor_out_of_range'
  | 'revenue_not_distributed';

@Entity('deal_health_alerts')
@Index(['dealId', 'alertType', 'resolvedAt'])
export class DealHealthAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'deal_id' })
  dealId: string;

  @ManyToOne(() => TradeDeal, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deal_id' })
  tradeDeal: TradeDeal;

  @Column({ name: 'alert_type', type: 'varchar', length: 64 })
  alertType: DealHealthAlertType;

  @Column({ name: 'alert_message', type: 'text' })
  alertMessage: string;

  @Column({ name: 'fired_at', type: 'timestamp with time zone' })
  firedAt: Date;

  @Column({ name: 'resolved_at', type: 'timestamp with time zone', nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
