import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds Soroban smart contract address columns to trade_deals
 * and a new marketplace_orders table for on-chain settlement tracking.
 */
export class AddSorobanContractIds1764000000000 implements MigrationInterface {
  name = 'AddSorobanContractIds1764000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // FarmCampaign contract address per deal
    await queryRunner.query(`
      ALTER TABLE "trade_deals"
      ADD COLUMN IF NOT EXISTS "soroban_campaign_contract_id" VARCHAR NULL,
      ADD COLUMN IF NOT EXISTS "soroban_factory_tx_hash" VARCHAR NULL,
      ADD COLUMN IF NOT EXISTS "soroban_initialized_at" TIMESTAMPTZ NULL
    `);

    // Marketplace orders table for on-chain settlement
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "marketplace_orders" (
        "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "trade_deal_id"         UUID NOT NULL REFERENCES "trade_deals"("id") ON DELETE CASCADE,
        "buyer_id"              UUID NOT NULL REFERENCES "users"("id"),
        "order_id_onchain"      VARCHAR NOT NULL UNIQUE,
        "amount_usdc"           NUMERIC(18, 7) NOT NULL,
        "status"                VARCHAR NOT NULL DEFAULT 'pending',
        "settlement_contract_id" VARCHAR NULL,
        "settlement_tx_hash"    VARCHAR NULL,
        "created_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "settled_at"            TIMESTAMPTZ NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_marketplace_orders_deal"
      ON "marketplace_orders" ("trade_deal_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_marketplace_orders_buyer"
      ON "marketplace_orders" ("buyer_id")
    `);

    // Investment certificates table (NFT-style on-chain proof)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "investment_certificates" (
        "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "investment_id"     UUID NOT NULL REFERENCES "investments"("id") ON DELETE CASCADE,
        "investor_id"       UUID NOT NULL REFERENCES "users"("id"),
        "trade_deal_id"     UUID NOT NULL REFERENCES "trade_deals"("id"),
        "certificate_hash"  VARCHAR NOT NULL,
        "stellar_tx_id"     VARCHAR NULL,
        "metadata_json"     JSONB NULL,
        "issued_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_cert_investment"
      ON "investment_certificates" ("investment_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "investment_certificates"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "marketplace_orders"`);
    await queryRunner.query(`
      ALTER TABLE "trade_deals"
      DROP COLUMN IF EXISTS "soroban_campaign_contract_id",
      DROP COLUMN IF EXISTS "soroban_factory_tx_hash",
      DROP COLUMN IF EXISTS "soroban_initialized_at"
    `);
  }
}
