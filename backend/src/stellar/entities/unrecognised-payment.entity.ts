import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

/**
 * Records incoming Stellar payments that could not be matched to a pending
 * investment via memo parsing.
 * Issue #905 — Stellar payment streaming
 */
@Entity('unrecognised_payments')
export class UnrecognisedPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Stellar transaction hash of the payment operation */
  @Column({ name: 'tx_hash', unique: true })
  txHash: string;

  /** Stellar account that sent the payment */
  @Column({ name: 'from_account' })
  fromAccount: string;

  /** Amount received (as raw string from Horizon to preserve precision) */
  @Column({ name: 'amount' })
  amount: string;

  /** Asset code, e.g. "XLM", "USDC" */
  @Column({ name: 'asset_code', nullable: true })
  assetCode: string | null;

  /** Asset issuer public key (null for native XLM) */
  @Column({ name: 'asset_issuer', nullable: true })
  assetIssuer: string | null;

  /** Raw memo text from the transaction, if present */
  @Column({ name: 'memo', nullable: true, type: 'text' })
  memo: string | null;

  /** Reason the payment could not be matched */
  @Column({ name: 'reason', type: 'text' })
  reason: string;

  /** Stellar ledger close time for this transaction */
  @Column({ name: 'stellar_created_at', type: 'timestamptz', nullable: true })
  stellarCreatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
