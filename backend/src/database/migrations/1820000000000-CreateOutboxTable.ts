import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOutboxTable1820000000000 implements MigrationInterface {
  name = 'CreateOutboxTable1820000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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

    await queryRunner.query(`
      CREATE INDEX "idx_outbox_unprocessed" ON "outbox" ("processed", "retry_count", "created_at")
      WHERE "processed" = FALSE
    `);

    // Add trigger to update updated_at timestamp
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
      CREATE TRIGGER update_outbox_updated_at
      BEFORE UPDATE ON "outbox"
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS update_outbox_updated_at ON "outbox"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_outbox_unprocessed"`);
    await queryRunner.query(`DROP TABLE "outbox"`);
  }
}