import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateDecimalPrecision1780000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trade_deals" ALTER COLUMN "quantity" TYPE numeric(10,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "trade_deals" ALTER COLUMN "total_value" TYPE numeric(10,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "trade_deals" ALTER COLUMN "total_invested" TYPE numeric(10,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "investments" ALTER COLUMN "amount_usd" TYPE numeric(10,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_distributions" ALTER COLUMN "amount_usd" TYPE numeric(10,2)`,
    );
  }
}
