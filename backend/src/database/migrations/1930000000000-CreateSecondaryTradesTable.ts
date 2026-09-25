import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSecondaryTradesTable1930000000000 implements MigrationInterface {
  name = 'CreateSecondaryTradesTable1930000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "secondary_trades" (
        "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_id"          VARCHAR(100) NOT NULL UNIQUE,
        "seller_id"         UUID NOT NULL,
        "buyer_id"          UUID NOT NULL,
        "token_code"        VARCHAR(20) NOT NULL,
        "token_amount"      DECIMAL(36,7) NOT NULL,
        "price_per_token"   DECIMAL(36,7) NOT NULL,
        "total_amount_usd"  DECIMAL(36,7) NOT NULL,
        "platform_fee_usd"  DECIMAL(36,7) NOT NULL DEFAULT 0,
        "net_amount_usd"    DECIMAL(36,7) NOT NULL,
        "tx_hash"           VARCHAR(100),
        "status"            VARCHAR(50) NOT NULL DEFAULT 'pending',
        "settled_at"        TIMESTAMPTZ,
        "seller_notified"   BOOLEAN NOT NULL DEFAULT false,
        "buyer_notified"    BOOLEAN NOT NULL DEFAULT false,
        "metadata"          JSONB NOT NULL DEFAULT '{}'::jsonb,
        "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_secondary_trades_seller_id" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_secondary_trades_buyer_id" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_secondary_trades_seller_id" ON "secondary_trades" ("seller_id")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_secondary_trades_buyer_id" ON "secondary_trades" ("buyer_id")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_secondary_trades_status" ON "secondary_trades" ("status")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_secondary_trades_token_code" ON "secondary_trades" ("token_code")`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_secondary_trades_created_at" ON "secondary_trades" ("created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "secondary_trades"`);
  }
}
