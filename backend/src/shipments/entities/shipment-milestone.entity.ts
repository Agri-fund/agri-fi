import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export type MilestoneType = 'farm' | 'warehouse' | 'port' | 'importer';

@Entity('shipment_milestones')
export class ShipmentMilestone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'trade_deal_id' })
  tradeDealId: string;

  @Column()
  milestone: MilestoneType;

  @Column({ name: 'recorded_by' })
  recordedBy: string;

  @Column({ nullable: true })
  notes: string | null;

  @Column({ name: 'stellar_tx_id', nullable: true })
  stellarTxId: string | null;

  @Column({ name: 'memo_text', nullable: true })
  memoText: string | null;

  @CreateDateColumn({ name: 'recorded_at' })
  recordedAt: Date;
}
