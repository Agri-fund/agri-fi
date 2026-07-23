import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('stellar_history')
export class StellarHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tx_hash', unique: true })
  txHash: string;

  @Column({ type: 'int' })
  ledger: number;

  @Column({ name: 'ledger_created_at', type: 'timestamp' })
  ledgerCreatedAt: Date;

  @Column({ type: 'jsonb' })
  payload: any;

  @CreateDateColumn({ name: 'archived_at' })
  archivedAt: Date;
}
