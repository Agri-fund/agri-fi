import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSep12DataToKycSubmissions1930000000001
  implements MigrationInterface
{
  name = 'AddSep12DataToKycSubmissions1930000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kyc_submissions"
        ADD COLUMN IF NOT EXISTS "sep12_data" jsonb;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kyc_submissions"
        DROP COLUMN IF EXISTS "sep12_data";
    `);
  }
}
