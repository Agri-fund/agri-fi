import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * #806 — Enforce MFA for admin role users.
 *
 * 1. Adds `mfa_enrollment_required` boolean column (default false) to `users`.
 * 2. Flags every existing admin / company_admin account that has not yet
 *    completed MFA setup by setting `mfa_enrollment_required = true`.
 *    These accounts will be blocked at login until they enroll.
 */
export class EnforceAdminMfa1940000000001 implements MigrationInterface {
  name = 'EnforceAdminMfa1940000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add the new column with a safe default so the migration is non-breaking.
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "mfa_enrollment_required" boolean NOT NULL DEFAULT false;
    `);

    // Flag existing admin/company_admin accounts that have not set up MFA.
    // These users will see the enrollment redirect on their next login attempt.
    await queryRunner.query(`
      UPDATE "users"
      SET "mfa_enrollment_required" = true
      WHERE role IN ('admin', 'company_admin')
        AND is_mfa_enabled = false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "mfa_enrollment_required";
    `);
  }
}
