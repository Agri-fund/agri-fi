import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('shipment_milestones_archive')
export class ShipmentMilestoneArchive {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'trade_deal_id' })
  tradeDealId: string;

  @Column()
  milestone: string;

  @Column({ name: 'recorded_by' })
  recordedBy: string;

  @Column({ nullable: true })
  notes: string | null;

  @Column({ name: 'stellar_tx_id', nullable: true })
  stellarTxId: string | null;

  @Column({ name: 'memo_text', nullable: true })
  memoText: string | null;

  @Column({ type: 'double precision', nullable: true })
  latitude: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude: number | null;

  @Column({ name: 'recorded_at', type: 'timestamptz', nullable: true })
  recordedAt: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ name: 'archived_at' })
  archivedAt: Date;
}
