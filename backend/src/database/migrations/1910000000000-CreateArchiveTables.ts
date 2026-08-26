import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateArchiveTables1910000000000 implements MigrationInterface {
  name = 'CreateArchiveTables1910000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add deleted_at soft-delete column to primary tables if not exists
    await queryRunner.query(
      `ALTER TABLE "trade_deals" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ`,
    );
    await queryRunner.query(
      `ALTER TABLE "investments" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ`,
    );
    await queryRunner.query(
      `ALTER TABLE "shipment_milestones" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ`,
    );

    // Create trade_deals_archive table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "trade_deals_archive" (
        "id"                            UUID PRIMARY KEY,
        "commodity"                     TEXT NOT NULL,
        "quantity"                      NUMERIC NOT NULL,
        "quantity_unit"                 TEXT NOT NULL DEFAULT 'kg',
        "total_value"                   NUMERIC NOT NULL,
        "token_count"                   INTEGER NOT NULL,
        "token_symbol"                  TEXT NOT NULL,
        "status"                        TEXT NOT NULL,
        "farmer_id"                     UUID NOT NULL,
        "trader_id"                     UUID NOT NULL,
        "escrow_public_key"             TEXT,
        "escrow_secret_key"             TEXT,
        "issuer_public_key"             TEXT,
        "issuer_secret_key"             TEXT,
        "total_invested"                NUMERIC NOT NULL DEFAULT 0,
        "delivery_date"                 DATE NOT NULL,
        "stellar_asset_tx_id"           TEXT,
        "soroban_campaign_contract_id"  TEXT,
        "soroban_factory_tx_hash"       TEXT,
        "app_trace_id"                  TEXT,
        "created_at"                    TIMESTAMPTZ,
        "deleted_at"                    TIMESTAMPTZ,
        "archived_at"                   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Create investments_archive table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "investments_archive" (
        "id"              UUID PRIMARY KEY,
        "trade_deal_id"   UUID NOT NULL,
        "investor_id"     UUID NOT NULL,
        "token_amount"    INTEGER NOT NULL,
        "amount_usd"      NUMERIC NOT NULL,
        "stellar_tx_id"   TEXT,
        "compliance_data" JSONB,
        "status"          TEXT NOT NULL,
        "created_at"      TIMESTAMPTZ,
        "deleted_at"      TIMESTAMPTZ,
        "archived_at"     TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Create shipment_milestones_archive table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "shipment_milestones_archive" (
        "id"              UUID PRIMARY KEY,
        "trade_deal_id"   UUID NOT NULL,
        "milestone"       TEXT NOT NULL,
        "recorded_by"     TEXT NOT NULL,
        "notes"           TEXT,
        "stellar_tx_id"   TEXT,
        "memo_text"       TEXT,
        "latitude"        DOUBLE PRECISION,
        "longitude"       DOUBLE PRECISION,
        "recorded_at"     TIMESTAMPTZ,
        "deleted_at"      TIMESTAMPTZ,
        "archived_at"     TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // Create indexes for fast querying of archived data
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_trade_deals_archive_created_at" ON "trade_deals_archive" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_investments_archive_trade_deal_id" ON "investments_archive" ("trade_deal_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_shipment_milestones_archive_trade_deal_id" ON "shipment_milestones_archive" ("trade_deal_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "shipment_milestones_archive"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "investments_archive"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "trade_deals_archive"`);
  }
}
