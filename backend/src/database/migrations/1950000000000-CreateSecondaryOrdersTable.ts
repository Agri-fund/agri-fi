import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSecondaryOrdersTable1950000000000 implements MigrationInterface {
  name = 'CreateSecondaryOrdersTable1950000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "secondary_sell_orders" (
        "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "investment_id"   UUID NOT NULL,
        "seller_id"       UUID NOT NULL,
        "deal_id"         UUID NOT NULL,
        "ask_price"       DECIMAL(36,7) NOT NULL,
        "quantity"        DECIMAL(36,7) NOT NULL,
        "filled_quantity" DECIMAL(36,7) NOT NULL DEFAULT 0,
        "expiry"          TIMESTAMPTZ,
        "status"          VARCHAR(30) NOT NULL DEFAULT 'open',
        "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "secondary_buy_orders" (
        "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "deal_id"         UUID NOT NULL,
        "buyer_id"        UUID NOT NULL,
        "bid_price"       DECIMAL(36,7) NOT NULL,
        "quantity"        DECIMAL(36,7) NOT NULL,
        "filled_quantity" DECIMAL(36,7) NOT NULL DEFAULT 0,
        "expiry"          TIMESTAMPTZ,
        "status"          VARCHAR(30) NOT NULL DEFAULT 'open',
        "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sell_orders_deal_status" ON "secondary_sell_orders" ("deal_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_buy_orders_deal_status" ON "secondary_buy_orders" ("deal_id", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "secondary_buy_orders"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "secondary_sell_orders"`);
  }
}
