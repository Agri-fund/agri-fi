import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Consolidates the split `secondary_sell_orders` / `secondary_buy_orders`
 * book (created in 1950000000000) into a single `secondary_orders` table with
 * a `side` discriminator, so fill-or-kill and stop-loss orders can be
 * expressed.
 *
 * Existing rows are preserved: sell orders become `side = 'sell'`, buy orders
 * `side = 'buy'`, all as `type = 'limit'`. `token_code` is carried over from
 * the order's trade deal where resolvable and otherwise left as a placeholder
 * so the NOT NULL constraint holds — those rows keep their `deal_id` and must
 * be re-pointed at a real token code before they can match.
 */
export class MigrateSecondaryOrdersToUnifiedTable1960000000000 implements MigrationInterface {
  name = 'MigrateSecondaryOrdersToUnifiedTable1960000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "secondary_orders" (
        "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_id"        VARCHAR(100) NOT NULL UNIQUE,
        "user_id"         UUID,
        "deal_id"         UUID,
        "investment_id"   UUID,
        "side"            VARCHAR(4) NOT NULL,
        "type"            VARCHAR(20) NOT NULL DEFAULT 'limit',
        "token_code"      VARCHAR(20) NOT NULL,
        "token_amount"    DECIMAL(36,7) NOT NULL,
        "filled_amount"   DECIMAL(36,7) NOT NULL DEFAULT 0,
        "price_per_token" DECIMAL(36,7) NOT NULL,
        "trigger_price"   DECIMAL(36,7),
        "stop_direction"  VARCHAR(10),
        "status"          VARCHAR(30) NOT NULL DEFAULT 'open',
        "expires_at"      TIMESTAMPTZ,
        "triggered_at"    TIMESTAMPTZ,
        "filled_at"       TIMESTAMPTZ,
        "cancelled_at"    TIMESTAMPTZ,
        "cancel_reason"   VARCHAR(100),
        "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_secondary_orders_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_secondary_orders_side" CHECK ("side" IN ('buy', 'sell')),
        CONSTRAINT "CHK_secondary_orders_type" CHECK ("type" IN ('limit', 'fok', 'stop_loss')),
        CONSTRAINT "CHK_secondary_orders_status" CHECK (
          "status" IN ('open', 'triggered', 'partially_filled', 'filled', 'cancelled', 'expired')
        ),
        CONSTRAINT "CHK_secondary_orders_amounts" CHECK (
          "token_amount" > 0 AND "filled_amount" >= 0 AND "filled_amount" <= "token_amount"
        ),
        CONSTRAINT "CHK_secondary_orders_stop" CHECK (
          ("type" = 'stop_loss' AND "trigger_price" IS NOT NULL AND "stop_direction" IN ('above', 'below'))
          OR ("type" <> 'stop_loss')
        )
      )
    `);

    // Migrated sell orders.
    await queryRunner.query(`
      INSERT INTO "secondary_orders" (
        "order_id", "user_id", "deal_id", "investment_id", "side", "type",
        "token_code", "token_amount", "filled_amount", "price_per_token",
        "status", "expires_at", "created_at", "updated_at"
      )
      SELECT
        'legacy-sell-' || s.id::text,
        s.seller_id,
        s.deal_id,
        s.investment_id,
        'sell',
        'limit',
        COALESCE(td.token_symbol, 'UNSET'),
        s.quantity,
        LEAST(s.filled_quantity, s.quantity),
        s.ask_price,
        s.status,
        s.expiry,
        s.created_at,
        s.updated_at
      FROM "secondary_sell_orders" s
      LEFT JOIN "trade_deals" td ON td.id = s.deal_id
      WHERE NOT EXISTS (
        SELECT 1 FROM "secondary_orders" o
        WHERE o.order_id = 'legacy-sell-' || s.id::text
      )
      ON CONFLICT (order_id) DO NOTHING
    `);

    // Migrated buy orders.
    await queryRunner.query(`
      INSERT INTO "secondary_orders" (
        "order_id", "user_id", "deal_id", "investment_id", "side", "type",
        "token_code", "token_amount", "filled_amount", "price_per_token",
        "status", "expires_at", "created_at", "updated_at"
      )
      SELECT
        'legacy-buy-' || b.id::text,
        b.buyer_id,
        b.deal_id,
        NULL,
        'buy',
        'limit',
        COALESCE(td.token_symbol, 'UNSET'),
        b.quantity,
        LEAST(b.filled_quantity, b.quantity),
        b.bid_price,
        b.status,
        b.expiry,
        b.created_at,
        b.updated_at
      FROM "secondary_buy_orders" b
      LEFT JOIN "trade_deals" td ON td.id = b.deal_id
      WHERE NOT EXISTS (
        SELECT 1 FROM "secondary_orders" o
        WHERE o.order_id = 'legacy-buy-' || b.id::text
      )
      ON CONFLICT (order_id) DO NOTHING
    `);

    // Price-time priority scan for the matching engine.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_secondary_orders_book" ON "secondary_orders" ("token_code", "side", "status", "price_per_token", "created_at")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_secondary_orders_user_id" ON "secondary_orders" ("user_id")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_secondary_orders_status" ON "secondary_orders" ("status")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_secondary_orders_token_code" ON "secondary_orders" ("token_code")`,
    );

    // Drives the scheduled matching sweep: untriggered stop orders to re-check
    // plus armed orders waiting for liquidity.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_secondary_orders_pending" ON "secondary_orders" ("type", "status")`,
    );

    // Legacy rows carrying the 'UNSET' token placeholder must not be matched.
    await queryRunner.query(
      `UPDATE "secondary_orders" SET "status" = 'cancelled', "cancel_reason" = 'migrated_unset_token', "cancelled_at" = now() WHERE "token_code" = 'UNSET' AND "status" IN ('open', 'triggered', 'partially_filled')`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "secondary_sell_orders"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "secondary_buy_orders"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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

    // Restore the sell book; buy rows whose investment_id is unknown cannot be
    // reconstructed because the old schema required it.
    await queryRunner.query(`
      INSERT INTO "secondary_sell_orders" (
        "id", "investment_id", "seller_id", "deal_id", "ask_price",
        "quantity", "filled_quantity", "expiry", "status", "created_at", "updated_at"
      )
      SELECT
        COALESCE(investment_id, gen_random_uuid()),
        investment_id,
        user_id,
        deal_id,
        price_per_token,
        token_amount,
        filled_amount,
        expires_at,
        status,
        created_at,
        updated_at
      FROM "secondary_orders"
      WHERE side = 'sell'
        AND investment_id IS NOT NULL
        AND deal_id IS NOT NULL
        AND user_id IS NOT NULL
      ON CONFLICT (id) DO NOTHING
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sell_orders_deal_status" ON "secondary_sell_orders" ("deal_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_buy_orders_deal_status" ON "secondary_buy_orders" ("deal_id", "status")`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "secondary_orders"`);
  }
}
