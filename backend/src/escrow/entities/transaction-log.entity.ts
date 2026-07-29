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

export type TxStatus = 'pending' | 'success' | 'failed';

/**
 * Mirrors the `transaction_logs` table created by migration 1745000000000.
 *
 * Every Stellar escrow operation (payout, distribution, retry) records a row
 * here so that admins can query failed payments from a single table and
 * trigger manual retries via the admin API.
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

  /** Stellar transaction hash (64-char hex). May be null for failed attempts
   *  that never reached the network. */
  @Column({ name: 'tx_hash', type: 'text', nullable: true })
  txHash: string | null;

  /** Raw XDR envelope for replay / audit. May be null for broker-level failures. */
  @Column({ name: 'xdr_body', type: 'text', nullable: true })
  xdrBody: string | null;

  /** Current lifecycle status of the transaction. */
  @Column({
    type: 'text',
    default: 'pending',
  })
  status: TxStatus;

  /** Machine-readable error code populated when status = 'failed'. */
  @Column({ name: 'error_code', type: 'text', nullable: true })
  errorCode: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
