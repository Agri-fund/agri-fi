import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Referral programme with platform credit rewards.
 * Adds platform_credit balance to users, referral_code_id to track referral source,
 * credit_issued_at to referrals, and uses_count to referral_codes.
 */
export class AddReferralProgrammeFeatures2280000000000 implements MigrationInterface {
  name = 'AddReferralProgrammeFeatures2280000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add platform_credit to users table
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "platform_credit" numeric(10,2) DEFAULT 0
    `);

    // Add referral_code_id to users table
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "referral_code_id" uuid
    `);

    // Add credit_issued_at to referrals table
    await queryRunner.query(`
      ALTER TABLE "referrals"
        ADD COLUMN IF NOT EXISTS "credit_issued_at" TIMESTAMPTZ
    `);

    // Add uses_count to referral_codes table
    await queryRunner.query(`
      ALTER TABLE "referral_codes"
        ADD COLUMN IF NOT EXISTS "uses_count" int DEFAULT 0
    `);

    // Drop old unique constraint on user_id in referral_codes (allow multiple referral codes per user)
    await queryRunner.query(`
      ALTER TABLE "referral_codes"
        DROP CONSTRAINT IF EXISTS "UQ_referral_codes_user_id"
    `);

    // Create index for platform_credit queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_users_platform_credit" ON "users" ("platform_credit")
    `);

    // Create index for referral_code_id
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_users_referral_code_id" ON "users" ("referral_code_id")
    `);

    // Create index for credit_issued_at for sorting recently credited referrals
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_referrals_credit_issued_at" ON "referrals" ("credit_issued_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_referrals_credit_issued_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_referral_code_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_platform_credit"`);
    await queryRunner.query(`
      ALTER TABLE "referral_codes"
        DROP COLUMN IF EXISTS "uses_count"
    `);
    await queryRunner.query(`
      ALTER TABLE "referrals"
        DROP COLUMN IF EXISTS "credit_issued_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "referral_code_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "platform_credit"
    `);
  }
}
