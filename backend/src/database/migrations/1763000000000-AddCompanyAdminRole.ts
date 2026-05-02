import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCompanyAdminRole1763000000000 implements MigrationInterface {
  name = 'AddCompanyAdminRole1763000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
      ALTER TABLE users ADD CONSTRAINT users_role_check
        CHECK (role IN ('farmer', 'trader', 'investor', 'admin', 'company_admin'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
      ALTER TABLE users ADD CONSTRAINT users_role_check
        CHECK (role IN ('farmer', 'trader', 'investor', 'admin'));
    `);
  }
}
