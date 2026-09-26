import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentDistributionAndApiKeyIndexes1970000000000
  implements MigrationInterface
{
  name = 'AddPaymentDistributionAndApiKeyIndexes1970000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_payment_distributions_trade_deal_status"
      ON "payment_distributions" ("trade_deal_id", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_api_keys_prefix"
      ON "api_keys" ("prefix")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_api_keys_prefix"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_payment_distributions_trade_deal_status"`,
    );
  }
}
