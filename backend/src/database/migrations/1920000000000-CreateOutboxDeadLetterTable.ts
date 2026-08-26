import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOutboxDeadLetterTable1920000000000 implements MigrationInterface {
  name = 'CreateOutboxDeadLetterTable1920000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "outbox_dead_letter" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "original_event_id" UUID NOT NULL,
        "event_type" VARCHAR(100) NOT NULL,
        "payload" JSONB NOT NULL,
        "retry_count" INTEGER NOT NULL,
        "last_error" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "moved_to_dlq_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_outbox_dlq_event_type" ON "outbox_dead_letter" ("event_type")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_outbox_dlq_created_at" ON "outbox_dead_letter" ("created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "outbox_dead_letter"`);
  }
}
