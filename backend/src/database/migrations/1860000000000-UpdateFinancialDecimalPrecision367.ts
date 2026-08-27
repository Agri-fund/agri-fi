import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateFinancialDecimalPrecision3671860000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trade_deals" ALTER COLUMN "quantity" TYPE decimal(36,7)`,
    );
    await queryRunner.query(
      `ALTER TABLE "trade_deals" ALTER COLUMN "total_value" TYPE decimal(36,7)`,
    );
    await queryRunner.query(
      `ALTER TABLE "trade_deals" ALTER COLUMN "total_invested" TYPE decimal(36,7)`,
    );
    await queryRunner.query(
      `ALTER TABLE "investments" ALTER COLUMN "amount_usd" TYPE decimal(36,7)`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_distributions" ALTER COLUMN "amount_usd" TYPE decimal(36,7)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trade_deals" ALTER COLUMN "quantity" TYPE decimal(18,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "trade_deals" ALTER COLUMN "total_value" TYPE decimal(18,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "trade_deals" ALTER COLUMN "total_invested" TYPE decimal(18,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "investments" ALTER COLUMN "amount_usd" TYPE decimal(18,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_distributions" ALTER COLUMN "amount_usd" TYPE decimal(18,2)`,
    );
  }
}
