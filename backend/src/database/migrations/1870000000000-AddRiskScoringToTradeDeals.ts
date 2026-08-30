import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRiskScoringToTradeDeals1870000000000
  implements MigrationInterface
{
  name = 'AddRiskScoringToTradeDeals1870000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_deals"
        ADD COLUMN IF NOT EXISTS "risk_score" decimal(5,2),
        ADD COLUMN IF NOT EXISTS "risk_rating" varchar(16),
        ADD COLUMN IF NOT EXISTS "risk_breakdown" jsonb;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trade_deals"
        DROP COLUMN IF EXISTS "risk_score",
        DROP COLUMN IF EXISTS "risk_rating",
        DROP COLUMN IF EXISTS "risk_breakdown";
    `);
  }
}
