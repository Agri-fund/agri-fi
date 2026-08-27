import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDealMetadataAndKycDraft1820000000000
  implements MigrationInterface
{
  name = 'AddDealMetadataAndKycDraft1820000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_deals"
        ADD COLUMN IF NOT EXISTS "title" TEXT,
        ADD COLUMN IF NOT EXISTS "short_description" TEXT,
        ADD COLUMN IF NOT EXISTS "long_description" TEXT,
        ADD COLUMN IF NOT EXISTS "country" TEXT,
        ADD COLUMN IF NOT EXISTS "region" TEXT,
        ADD COLUMN IF NOT EXISTS "expected_roi" NUMERIC(6,2),
        ADD COLUMN IF NOT EXISTS "duration_days" INTEGER,
        ADD COLUMN IF NOT EXISTS "min_investment_lot" NUMERIC(18,2),
        ADD COLUMN IF NOT EXISTS "risk_rating" TEXT,
        ADD COLUMN IF NOT EXISTS "farm_location" TEXT,
        ADD COLUMN IF NOT EXISTS "farm_latitude" NUMERIC(10,6),
        ADD COLUMN IF NOT EXISTS "farm_longitude" NUMERIC(10,6),
        ADD COLUMN IF NOT EXISTS "farm_photos" JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS "supporting_documents" JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS "logistics_plan" JSONB NOT NULL DEFAULT '[]'::jsonb
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "kyc_draft" JSONB
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_trade_deals_search_vector"
      ON "trade_deals"
      USING GIN (
        to_tsvector(
          'english',
          coalesce("title", '') || ' ' ||
          coalesce("short_description", '') || ' ' ||
          coalesce("long_description", '')
        )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_trade_deals_public_marketplace"
      ON "trade_deals" ("status", "country", "risk_rating", "duration_days")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_trade_deals_public_marketplace"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_trade_deals_search_vector"
    `);
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "kyc_draft"
    `);
    await queryRunner.query(`
      ALTER TABLE "trade_deals"
        DROP COLUMN IF EXISTS "title",
        DROP COLUMN IF EXISTS "short_description",
        DROP COLUMN IF EXISTS "long_description",
        DROP COLUMN IF EXISTS "country",
        DROP COLUMN IF EXISTS "region",
        DROP COLUMN IF EXISTS "expected_roi",
        DROP COLUMN IF EXISTS "duration_days",
        DROP COLUMN IF EXISTS "min_investment_lot",
        DROP COLUMN IF EXISTS "risk_rating",
        DROP COLUMN IF EXISTS "farm_location",
        DROP COLUMN IF EXISTS "farm_latitude",
        DROP COLUMN IF EXISTS "farm_longitude",
        DROP COLUMN IF EXISTS "farm_photos",
        DROP COLUMN IF EXISTS "supporting_documents",
        DROP COLUMN IF EXISTS "logistics_plan"
    `);
  }
}
