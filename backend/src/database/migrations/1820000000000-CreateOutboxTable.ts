import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Originally a duplicate CREATE TABLE for outbox. Now evolves the table
 * created by CreateOutboxTable1810000000000 (adds updated_at + partial index).
 */
export class CreateOutboxTable1820000000000 implements MigrationInterface {
  name = 'CreateOutboxTable1820000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tables = await queryRunner.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'outbox'
      LIMIT 1
    `);

    if (!tables.length) {
      await queryRunner.query(`
        CREATE TABLE "outbox" (
          "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          "event_type" VARCHAR(100) NOT NULL,
          "payload" JSONB NOT NULL,
          "processed" BOOLEAN NOT NULL DEFAULT FALSE,
          "retry_count" INTEGER NOT NULL DEFAULT 0,
          "last_error" TEXT,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "processed_at" TIMESTAMPTZ
        )
      `);
    } else {
      await queryRunner.query(`
        ALTER TABLE "outbox"
          ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      `);
    }

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_outbox_unprocessed"
      ON "outbox" ("processed", "retry_count", "created_at")
      WHERE "processed" = FALSE
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      DROP TRIGGER IF EXISTS update_outbox_updated_at ON "outbox"
    `);

    await queryRunner.query(`
      CREATE TRIGGER update_outbox_updated_at
      BEFORE UPDATE ON "outbox"
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS update_outbox_updated_at ON "outbox"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_outbox_unprocessed"`);
    // Do not drop the table — it may still be owned by the earlier migration.
  }
}
