import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Persisted record of a Soroban contract event the indexer has already
 * applied to the local database (#791).
 *
 * The event indexer previously tracked "already processed" purely in an
 * in-process Map, which is empty again on every restart, and separately
 * re-derived its polling start point as "current tip minus 100 ledgers" on
 * every restart too — so a restart could both reprocess recent events *and*
 * silently skip anything older than 100 ledgers back. This table replaces
 * both: `id` is the Soroban RPC event id (already globally unique per the
 * RPC's own guarantees), and the indexer resumes polling from
 * `MAX(ledger)` here instead of an ephemeral in-memory cursor.
 */
@Entity('processed_soroban_events')
export class ProcessedSorobanEvent {
  /** Soroban RPC event id — globally unique, used as the idempotency key. */
  @PrimaryColumn()
  id: string;

  @Index()
  @Column()
  contractId: string;

  @Column()
  transactionHash: string;

  @Index()
  @Column()
  ledger: number;

  @Column()
  eventType: string;

  @CreateDateColumn()
  processedAt: Date;
}
