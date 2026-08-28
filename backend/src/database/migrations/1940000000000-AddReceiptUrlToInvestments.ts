import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReceiptUrlToInvestments1940000000000
  implements MigrationInterface
{
  name = 'AddReceiptUrlToInvestments1940000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "investments"
        ADD COLUMN IF NOT EXISTS "receipt_url" VARCHAR(2048),
        ADD COLUMN IF NOT EXISTS "receipt_generated_at" TIMESTAMPTZ;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "investments"
        DROP COLUMN IF EXISTS "receipt_url",
        DROP COLUMN IF EXISTS "receipt_generated_at";
    `);
  }
}
