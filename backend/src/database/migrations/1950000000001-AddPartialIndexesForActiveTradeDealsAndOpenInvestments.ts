import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPartialIndexesForActiveTradeDealsAndOpenInvestments1950000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_trade_deals_active" ON "trade_deals" ("status") WHERE "status" = 'open'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_investments_open" ON "investments" ("status") WHERE "status" = 'active'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_trade_deals_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_investments_open"`);
  }
}
