import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { TradeDeal } from '../../trade-deals/entities/trade-deal.entity';
import { User } from '../../auth/entities/user.entity';

/**
 * Shared status domain for `transaction_logs`.
 * Mirrors migration 1745000000000 plus `pending_claim` used when investor
 * payouts are parked as Stellar claimable balances.
 */
export enum TxStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  PENDING_CLAIM = 'pending_claim',
}

/**
 * Single shared entity for the `transaction_logs` table created by
 * migration 1745000000000-CreateTransactionLogs.
 *
 * Previously duplicated in escrow and stellar modules; both now import this
 * class so TypeORM registers exactly one mapping for the table (#950).
 */
@Entity('transaction_logs')
export class TransactionLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Null when the transaction could not be attributed to a specific user. */
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  /** Null if the transaction is not associated with a trade deal. */
  @Column({ name: 'deal_id', type: 'uuid', nullable: true })
  dealId: string | null;

  @ManyToOne(() => TradeDeal, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'deal_id' })
  deal: TradeDeal | null;

  /** Stellar transaction hash. May be null for failed attempts that never reached the network. */
  @Column({ name: 'tx_hash', type: 'text', nullable: true })
  txHash: string | null;

  /** Raw XDR envelope for replay / audit. */
  @Column({ name: 'xdr_body', type: 'text', nullable: true })
  xdrBody: string | null;

  @Column({
    type: 'text',
    default: TxStatus.PENDING,
  })
  status: TxStatus;

  /** Machine-readable error code populated when status = failed. */
  @Column({ name: 'error_code', type: 'text', nullable: true })
  errorCode: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
