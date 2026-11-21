import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * #1385: deals are stored in USD; display_currency + fx_rate_at_creation
 * capture the farmer-facing currency and the rate at deal creation.
 * (users.deleted_at for #1386 already exists via 1766000000000-AddUserSoftDelete.)
 */
export class AddTradeDealDisplayCurrency2250000000000
  implements MigrationInterface
{
  name = 'AddTradeDealDisplayCurrency2250000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trade_deals" ADD COLUMN IF NOT EXISTS "display_currency" VARCHAR(3) NOT NULL DEFAULT 'USD'`,
    );
    await queryRunner.query(
      `ALTER TABLE "trade_deals" ADD COLUMN IF NOT EXISTS "fx_rate_at_creation" DECIMAL(20,8) NOT NULL DEFAULT 1`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trade_deals" DROP COLUMN IF EXISTS "fx_rate_at_creation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "trade_deals" DROP COLUMN IF EXISTS "display_currency"`,
    );
  }
}
