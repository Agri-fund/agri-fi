import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWebhookDeliveries2260000000000 implements MigrationInterface {
  name = 'CreateWebhookDeliveries2260000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "subscription_id" UUID NOT NULL,
        "event" VARCHAR(100) NOT NULL,
        "payload" TEXT NOT NULL,
        "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
        "attempt_count" INTEGER NOT NULL DEFAULT 0,
        "next_attempt_at" TIMESTAMPTZ,
        "last_status_code" INTEGER,
        "last_error" TEXT,
        "delivered_at" TIMESTAMPTZ,
        "attempts" JSONB NOT NULL DEFAULT '[]',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "IDX_webhook_deliveries_subscription" ON "webhook_deliveries" ("subscription_id");
      CREATE INDEX IF NOT EXISTS "IDX_webhook_deliveries_status_next" ON "webhook_deliveries" ("status", "next_attempt_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_deliveries"`);
  }
}
