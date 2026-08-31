import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFundingTermsToTradeDeals1940000000000 implements MigrationInterface {
  name = 'AddFundingTermsToTradeDeals1940000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_deals"
        ADD COLUMN IF NOT EXISTS "funding_deadline" TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS "minimum_funding_target" NUMERIC(36,7);
      UPDATE "trade_deals"
        SET "funding_deadline" = "delivery_date",
            "minimum_funding_target" = "total_value"
        WHERE "funding_deadline" IS NULL OR "minimum_funding_target" IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_deals"
        DROP COLUMN IF EXISTS "funding_deadline",
        DROP COLUMN IF EXISTS "minimum_funding_target";
    `);
  }
}