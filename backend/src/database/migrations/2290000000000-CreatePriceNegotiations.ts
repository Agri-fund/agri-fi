import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePriceNegotiations2290000000000 implements MigrationInterface {
  name = 'CreatePriceNegotiations2290000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "price_negotiations" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "deal_id" UUID NOT NULL REFERENCES "trade_deals"("id") ON DELETE CASCADE,
        "proposer_id" UUID NOT NULL REFERENCES "users"("id"),
        "proposed_price" NUMERIC(36, 7) NOT NULL,
        "message" TEXT,
        "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "IDX_price_negotiations_deal_id" ON "price_negotiations" ("deal_id");
      CREATE INDEX IF NOT EXISTS "IDX_price_negotiations_proposer_id" ON "price_negotiations" ("proposer_id");
      CREATE INDEX IF NOT EXISTS "IDX_price_negotiations_status" ON "price_negotiations" ("status");
      CREATE INDEX IF NOT EXISTS "IDX_price_negotiations_deal_created" ON "price_negotiations" ("deal_id", "created_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "price_negotiations"`);
  }
}
