import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMfaBackupCodesAndLockout1860000000000 implements MigrationInterface {
  name = 'AddMfaBackupCodesAndLockout1860000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "mfa_backup_codes" jsonb,
        ADD COLUMN IF NOT EXISTS "mfa_failed_attempts" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "mfa_locked_until" timestamptz;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "mfa_backup_codes",
        DROP COLUMN IF EXISTS "mfa_failed_attempts",
        DROP COLUMN IF EXISTS "mfa_locked_until";
    `);
  }
}
