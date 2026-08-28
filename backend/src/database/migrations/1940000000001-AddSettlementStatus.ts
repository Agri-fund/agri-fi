import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds settlement tracking columns to trade_deals (#899).
 */
export class AddSettlementStatus1940000000001 implements MigrationInterface {
  name = 'AddSettlementStatus1940000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_deals"
      ADD COLUMN IF NOT EXISTS "settlement_status" VARCHAR(32) NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS "settlement_tx_hash" VARCHAR NULL,
      ADD COLUMN IF NOT EXISTS "settlement_harvest_amount" NUMERIC(18, 7) NULL,
      ADD COLUMN IF NOT EXISTS "settlement_quality_grade" INT NULL,
      ADD COLUMN IF NOT EXISTS "settled_at" TIMESTAMPTZ NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_trade_deals_settlement_status"
      ON "trade_deals" ("settlement_status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_trade_deals_settlement_status"`);
    await queryRunner.query(`
      ALTER TABLE "trade_deals"
      DROP COLUMN IF EXISTS "settled_at",
      DROP COLUMN IF EXISTS "settlement_quality_grade",
      DROP COLUMN IF EXISTS "settlement_harvest_amount",
      DROP COLUMN IF EXISTS "settlement_tx_hash",
      DROP COLUMN IF EXISTS "settlement_status"
    `);
  }
}
