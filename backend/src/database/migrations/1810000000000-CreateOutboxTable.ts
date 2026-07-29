import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOutboxTable1810000000000 implements MigrationInterface {
  name = 'CreateOutboxTable1810000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "outbox" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "event_type" character varying(255) NOT NULL,
        "payload" jsonb NOT NULL,
        "processed" boolean NOT NULL DEFAULT false,
        "retry_count" integer NOT NULL DEFAULT 0,
        "last_error" text,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "processed_at" TIMESTAMPTZ,
        CONSTRAINT "PK_outbox" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_outbox_processed_created" ON "outbox" ("processed", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_outbox_event_type" ON "outbox" ("event_type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_outbox_processed" ON "outbox" ("processed")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_outbox_processed_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_outbox_event_type"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_outbox_processed"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "outbox"`);
  }
}