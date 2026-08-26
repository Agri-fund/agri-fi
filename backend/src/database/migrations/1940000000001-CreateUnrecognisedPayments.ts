import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableIndex,
  TableColumn,
} from 'typeorm';

/**
 * Migration: CreateUnrecognisedPayments
 *
 * Creates the `unrecognised_payments` table to store incoming Stellar payments
 * that cannot be matched to a known investment (unmatched memo, wrong asset, etc.).
 * Records are created by StellarMonitorService payment-streaming logic and used
 * to drive ops alerts and manual reconciliation.
 *
 * Also adds a `stellar_tx_hash` UNIQUE column to the `investments` table so that
 * the payment-streaming handler can perform fast duplicate detection against
 * already-confirmed investments (complements the in-memory dedup cache).
 *
 * Issue #905 — Stellar payment streaming & reconciliation
 */
export class CreateUnrecognisedPayments1940000000001
  implements MigrationInterface
{
  name = 'CreateUnrecognisedPayments1940000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. Create unrecognised_payments table ───────────────────────────────
    await queryRunner.createTable(
      new Table({
        name: 'unrecognised_payments',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'stellar_tx_hash',
            type: 'text',
            isUnique: true,
            isNullable: false,
          },
          {
            name: 'from_account',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'amount',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'asset_code',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'asset_issuer',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'memo',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'raw_record',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'alerted_at',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'now()',
            isNullable: false,
          },
        ],
      }),
    );

    // ── 2. Index on stellar_tx_hash for fast duplicate lookups ───────────────
    await queryRunner.createIndex(
      'unrecognised_payments',
      new TableIndex({
        name: 'idx_unrecognised_payments_hash',
        columnNames: ['stellar_tx_hash'],
      }),
    );

    // ── 3. Add stellar_tx_hash column to investments for dedup detection ─────
    //    The column is nullable because existing rows won't have a value; new
    //    confirmed-via-stream investments will have the hash populated.
    await queryRunner.addColumn(
      'investments',
      new TableColumn({
        name: 'stellar_tx_hash',
        type: 'text',
        isUnique: true,
        isNullable: true,
      }),
    );

    await queryRunner.createIndex(
      'investments',
      new TableIndex({
        name: 'idx_investments_stellar_tx_hash',
        columnNames: ['stellar_tx_hash'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'investments',
      'idx_investments_stellar_tx_hash',
    );
    await queryRunner.dropColumn('investments', 'stellar_tx_hash');
    await queryRunner.dropTable('unrecognised_payments');
  }
}
