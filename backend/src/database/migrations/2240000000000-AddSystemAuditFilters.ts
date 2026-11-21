import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSystemAuditFilters2240000000000 implements MigrationInterface {
  name = 'AddSystemAuditFilters2240000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN "compliance_domain" VARCHAR;
      ALTER TABLE "system_audit_logs"
        ADD COLUMN "action" VARCHAR,
        ADD COLUMN "resource_type" VARCHAR,
        ADD COLUMN "resource_id" VARCHAR,
        ADD COLUMN "compliance_domain" VARCHAR,
        ADD COLUMN "created_at" TIMESTAMPTZ;
      UPDATE "system_audit_logs"
        SET "action" = split_part("route", ' ', 1),
            "created_at" = "timestamp";
      ALTER TABLE "system_audit_logs"
        ALTER COLUMN "created_at" SET NOT NULL,
        ALTER COLUMN "created_at" SET DEFAULT now();
      CREATE INDEX "idx_system_audit_actor_created"
        ON "system_audit_logs" ("actor_id", "created_at");
      CREATE INDEX "idx_system_audit_action_created"
        ON "system_audit_logs" ("action", "created_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_system_audit_action_created";
      DROP INDEX IF EXISTS "idx_system_audit_actor_created";
      ALTER TABLE "system_audit_logs"
        DROP COLUMN "created_at",
        DROP COLUMN "resource_id",
        DROP COLUMN "compliance_domain",
        DROP COLUMN "resource_type",
        DROP COLUMN "action";
      ALTER TABLE "users" DROP COLUMN "compliance_domain";
    `);
  }
}
