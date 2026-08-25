import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum Sep24TxKind {
  DEPOSIT = 'deposit',
  WITHDRAW = 'withdraw',
}

/** SEP-24 transaction statuses — https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md */
export enum Sep24TxStatus {
  INCOMPLETE = 'incomplete',
  PENDING_ANCHOR = 'pending_anchor',
  PENDING_EXTERNAL = 'pending_external',
  PENDING_STELLAR = 'pending_stellar',
  PENDING_USER = 'pending_user',
  PENDING_USER_TRANSFER_START = 'pending_user_transfer_start',
  PENDING_TRUST = 'pending_trust',
  COMPLETED = 'completed',
  ERROR = 'error',
  REFUNDED = 'refunded',
  EXPIRED = 'expired',
}

@Entity('sep24_transactions')
export class Sep24Transaction {
  @PrimaryColumn()
  id: string;

  @Column({ name: 'stellar_account' })
  stellarAccount: string;

  @Column({ name: 'user_id', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 16 })
  kind: Sep24TxKind;

  @Column({ name: 'asset_code' })
  assetCode: string;

  @Column({ name: 'amount_in', type: 'varchar', nullable: true })
  amountIn: string | null;

  @Column({ name: 'amount_out', type: 'varchar', nullable: true })
  amountOut: string | null;

  @Column({ type: 'varchar', length: 32, default: Sep24TxStatus.INCOMPLETE })
  status: Sep24TxStatus;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ type: 'varchar', nullable: true })
  dest: string | null;

  @Column({ name: 'dest_extra', type: 'varchar', nullable: true })
  destExtra: string | null;

  @Column({ name: 'external_tx_id', type: 'varchar', nullable: true })
  externalTxId: string | null;

  @Column({ name: 'stellar_transaction_id', type: 'varchar', nullable: true })
  stellarTransactionId: string | null;

  @CreateDateColumn({ name: 'started_at' })
  startedAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
