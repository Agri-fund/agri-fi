import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum TxStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
}

@Entity('transaction_logs')
export class TransactionLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', nullable: true })
  userId: string | null;

  @Column({ name: 'deal_id', nullable: true })
  dealId: string | null;

  @Column({ name: 'tx_hash', nullable: true })
  txHash: string | null;

  @Column({ name: 'xdr_body', type: 'text', nullable: true })
  xdrBody: string | null;

  @Column({ type: 'text', default: TxStatus.PENDING })
  status: TxStatus;

  @Column({ name: 'error_code', nullable: true })
  errorCode: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
