import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEmailVerificationAndLockout1765000000000 implements MigrationInterface {
  name = 'AddEmailVerificationAndLockout1765000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS is_email_verified       BOOLEAN     NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS email_verification_token TEXT,
        ADD COLUMN IF NOT EXISTS failed_login_attempts   INTEGER     NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS lockout_until            TIMESTAMPTZ;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        DROP COLUMN IF EXISTS is_email_verified,
        DROP COLUMN IF EXISTS email_verification_token,
        DROP COLUMN IF EXISTS failed_login_attempts,
        DROP COLUMN IF EXISTS lockout_until;
    `);
  }
}
