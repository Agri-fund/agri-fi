import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * No-op — reconciled duplicate (#951).
 *
 * This migration and 1820000000000-CreateOutboxTable both attempted to
 * `CREATE TABLE "outbox"`. Only one could ever actually succeed: TypeORM
 * runs migrations in timestamp order, so on any environment that ran both,
 * this one (the earlier timestamp) created the table first and
 * 1820000000000 would then fail with "relation already exists" —
 * migration:run could never complete past this pair.
 *
 * 1820000000000-CreateOutboxTable is the one kept authoritative: its
 * schema is the one that actually matches src/outbox/outbox.entity.ts
 * today — the `updated_at` column (`@UpdateDateColumn`) and its
 * auto-update trigger, the `idx_outbox_unprocessed` index (exact name and
 * column set the entity's `@Index` decorator declares), and `VARCHAR(100)`
 * for `event_type` (matching the entity's `@Column({ length: 100 })` and
 * the later CreateOutboxDeadLetterTable migration's convention). This
 * migration's own schema — no `updated_at`, three differently-named
 * indexes, `VARCHAR(255)` — does not match the entity and was superseded.
 *
 * The migration is kept as a no-op (not deleted) rather than removed
 * outright, so migration *history* stays linear and any environment that
 * already recorded this one as applied (via TypeORM's migrations tracking
 * table) doesn't lose that record or have its history renumbered
 * out from under it. `down()` is a no-op for the same reason: reverting
 * this entry must not attempt to touch a table (or its trigger/indexes)
 * that IT never actually created.
 */
export class CreateOutboxTable1810000000000 implements MigrationInterface {
  name = 'CreateOutboxTable1810000000000';

  public async up(_queryRunner: QueryRunner): Promise<void> {
    // Intentionally empty — see class doc comment.
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Intentionally empty — see class doc comment.
  }
}
