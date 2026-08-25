import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('investments_archive')
export class InvestmentArchive {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'trade_deal_id' })
  tradeDealId: string;

  @Column({ name: 'investor_id' })
  investorId: string;

  @Column({ name: 'token_amount' })
  tokenAmount: number;

  @Column({ name: 'amount_usd', type: 'decimal', precision: 36, scale: 7 })
  amountUsd: number;

  @Column({ name: 'stellar_tx_id', nullable: true })
  stellarTxId: string | null;

  @Column({ name: 'compliance_data', type: 'jsonb', nullable: true })
  complianceData: Record<string, unknown> | null;

  @Column()
  status: string;

  @Column({ name: 'created_at', type: 'timestamptz', nullable: true })
  createdAt: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ name: 'archived_at' })
  archivedAt: Date;
}
