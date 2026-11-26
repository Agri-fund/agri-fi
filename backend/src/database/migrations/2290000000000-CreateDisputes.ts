import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Issue #1387 — Escrow dispute resolution workflow for undelivered shipments.
 *
 * Creates the `disputes` table tracking investor-raised shipment disputes,
 * attached evidence URLs, admin review state, and 14-day escalation status.
 */
export class CreateDisputes2290000000000 implements MigrationInterface {
  name = 'CreateDisputes2290000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "disputes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "deal_id" uuid NOT NULL,
        "raised_by" uuid NOT NULL,
        "reason" text NOT NULL,
        "evidence_urls" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "status" varchar(32) NOT NULL DEFAULT 'OPEN',
        "reviewed_by" uuid,
        "resolution_notes" text,
        "resolved_at" timestamptz,
        "escalated_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_disputes_deal" FOREIGN KEY ("deal_id") REFERENCES "trade_deals"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_disputes_raised_by" FOREIGN KEY ("raised_by") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_disputes_status" CHECK ("status" IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED_FARMER', 'RESOLVED_INVESTOR', 'ESCALATED'))
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_disputes_deal_status" ON "disputes" ("deal_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_disputes_status_created" ON "disputes" ("status", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_disputes_status_created"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_disputes_deal_status"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "disputes"`);
  }
}
