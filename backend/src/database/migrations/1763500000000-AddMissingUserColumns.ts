import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMissingUserColumns1763500000000 implements MigrationInterface {
  name = 'AddMissingUserColumns1763500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_company BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS company_details TEXT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users DROP COLUMN IF EXISTS token_version;
      ALTER TABLE users DROP COLUMN IF EXISTS is_company;
      ALTER TABLE users DROP COLUMN IF EXISTS company_details;
    `);
  }
}
