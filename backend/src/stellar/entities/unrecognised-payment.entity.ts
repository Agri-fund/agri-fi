import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Persists incoming Stellar payments that could not be matched to a known
 * investment record.  These are created by StellarMonitorService when the
 * payment stream delivers a transaction whose memo does not match the
 * `DEAL-{dealId}-INV-{investmentId}` pattern (or whose investment ID does not
 * exist in the database).
 *
 * Rows drive ops alerts and are used for manual reconciliation.
 * Issue #905 — Stellar payment streaming & reconciliation
 */
@Entity('unrecognised_payments')
@Index('idx_unrecognised_payments_hash', ['stellarTxHash'])
export class UnrecognisedPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'stellar_tx_hash', unique: true })
  stellarTxHash: string;

  @Column({ name: 'from_account' })
  fromAccount: string;

  @Column()
  amount: string;

  @Column({ name: 'asset_code', nullable: true })
  assetCode: string | null;

  @Column({ name: 'asset_issuer', nullable: true })
  assetIssuer: string | null;

  @Column({ nullable: true })
  memo: string | null;

  @Column({ name: 'raw_record', type: 'jsonb', nullable: true })
  rawRecord: any;

  @Column({ name: 'alerted_at', type: 'timestamptz', nullable: true })
  alertedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
