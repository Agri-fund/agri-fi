import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLotSizeToTradeDeals1930000000002 implements MigrationInterface {
  name = 'AddLotSizeToTradeDeals1930000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_deals"
        ADD COLUMN IF NOT EXISTS "min_lot_size" decimal(36,7) NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "lot_step" decimal(36,7) NOT NULL DEFAULT 1;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_deals"
        DROP COLUMN IF EXISTS "min_lot_size",
        DROP COLUMN IF EXISTS "lot_step";
    `);
  }
}
