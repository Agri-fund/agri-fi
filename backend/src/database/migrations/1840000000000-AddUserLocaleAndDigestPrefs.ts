import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration (#897, #892): Add notification preference columns to users.
 *
 * - preferred_language: locale used to select localized email templates (#897)
 * - timezone: IANA timezone for timezone-aware scheduling (#892)
 * - email_digest_enabled: opt-in flag for the weekly deal digest (#892)
 */
export class AddUserLocaleAndDigestPrefs1840000000000 implements MigrationInterface {
  name = 'AddUserLocaleAndDigestPrefs1840000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferred_language" varchar(8) NOT NULL DEFAULT 'en'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "timezone" varchar(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_digest_enabled" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "email_digest_enabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "timezone"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "preferred_language"`,
    );
  }
}
