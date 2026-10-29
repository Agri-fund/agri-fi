import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnhanceAutoInvestStrategies2220000000000 implements MigrationInterface {
  name = 'EnhanceAutoInvestStrategies2220000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auto_invest_plans"
        ADD COLUMN "name" varchar(120) NOT NULL DEFAULT 'Auto-invest strategy',
        ADD COLUMN "minimum_expected_roi" decimal(6,2),
        ADD COLUMN "region_filter" jsonb,
        ADD COLUMN "max_duration_days" integer,
        ADD COLUMN "max_position_usd" decimal(36,7),
        ADD COLUMN "is_public" boolean NOT NULL DEFAULT false,
        ADD COLUMN "version" integer NOT NULL DEFAULT 1,
        ADD COLUMN "version_history" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_auto_invest_plans_public"
      ON "auto_invest_plans" ("is_public", "updated_at")
      WHERE "deleted_at" IS NULL AND "is_public" = true AND "status" = 'active'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IDX_auto_invest_plans_public"');
    await queryRunner.query(`
      ALTER TABLE "auto_invest_plans"
        DROP COLUMN "version_history",
        DROP COLUMN "version",
        DROP COLUMN "is_public",
        DROP COLUMN "max_position_usd",
        DROP COLUMN "max_duration_days",
        DROP COLUMN "region_filter",
        DROP COLUMN "minimum_expected_roi",
        DROP COLUMN "name"
    `);
  }
}