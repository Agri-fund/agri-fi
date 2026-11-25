import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDealDiscovery2270000000000 implements MigrationInterface {
  name = 'CreateDealDiscovery2270000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "saved_searches" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "name" VARCHAR(100) NOT NULL,
        "filters" JSONB NOT NULL,
        "notify_in_app" BOOLEAN NOT NULL DEFAULT true,
        "notify_email" BOOLEAN NOT NULL DEFAULT false,
        "seen_deal_ids" JSONB NOT NULL DEFAULT '[]',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "IDX_saved_searches_user" ON "saved_searches" ("user_id");

      CREATE TABLE IF NOT EXISTS "search_history" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL,
        "filters" JSONB NOT NULL,
        "result_count" INTEGER NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "IDX_search_history_user_created" ON "search_history" ("user_id", "created_at");

      -- Marketplace filter and sort columns
      CREATE INDEX IF NOT EXISTS "idx_trade_deals_status_roi" ON "trade_deals" ("status", "expected_roi");
      CREATE INDEX IF NOT EXISTS "idx_trade_deals_status_min_lot" ON "trade_deals" ("status", "min_investment_lot");
      CREATE INDEX IF NOT EXISTS "idx_trade_deals_status_created" ON "trade_deals" ("status", "created_at" DESC);
      CREATE INDEX IF NOT EXISTS "idx_trade_deals_status_delivery" ON "trade_deals" ("status", "delivery_date");
      CREATE INDEX IF NOT EXISTS "idx_trade_deals_commodity_lower" ON "trade_deals" (LOWER("commodity"));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_trade_deals_commodity_lower";
      DROP INDEX IF EXISTS "idx_trade_deals_status_delivery";
      DROP INDEX IF EXISTS "idx_trade_deals_status_created";
      DROP INDEX IF EXISTS "idx_trade_deals_status_min_lot";
      DROP INDEX IF EXISTS "idx_trade_deals_status_roi";
      DROP TABLE IF EXISTS "search_history";
      DROP TABLE IF EXISTS "saved_searches";
    `);
  }
}
