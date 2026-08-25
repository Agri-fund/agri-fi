import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditLogs1800000000000 implements MigrationInterface {
  name = 'CreateAuditLogs1800000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "entity_name" VARCHAR NOT NULL,
        "entity_id"   VARCHAR,
        "action"      VARCHAR(20) NOT NULL,
        "old_values"  JSONB,
        "new_values"  JSONB,
        "changes"     TEXT,
        "user_id"     UUID REFERENCES users(id) ON DELETE SET NULL,
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_entity" ON "audit_logs" ("entity_name", "entity_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_audit_logs_user_id" ON "audit_logs" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
  }
}
