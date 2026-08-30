import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateComplianceAlertsTable1920000000000 implements MigrationInterface {
  name = 'CreateComplianceAlertsTable1920000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "compliance_alerts" (
        "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "alert_type"    VARCHAR(100) NOT NULL,
        "user_id"       UUID,
        "wallet_address" VARCHAR(56),
        "user_name"     VARCHAR(255),
        "match_reason"  TEXT NOT NULL,
        "risk_score"    INTEGER,
        "source"        VARCHAR(100) NOT NULL DEFAULT 'ofac_screening',
        "status"        VARCHAR(50) NOT NULL DEFAULT 'pending',
        "acknowledged_by" UUID,
        "acknowledged_at" TIMESTAMPTZ,
        "dismissed_at" TIMESTAMPTZ,
        "metadata"      JSONB NOT NULL DEFAULT '{}'::jsonb,
        "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_compliance_alerts_status" ON "compliance_alerts" ("status")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_compliance_alerts_user_id" ON "compliance_alerts" ("user_id")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_compliance_alerts_created_at" ON "compliance_alerts" ("created_at")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_compliance_alerts_alert_type" ON "compliance_alerts" ("alert_type")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "compliance_alerts"`);
  }
}
