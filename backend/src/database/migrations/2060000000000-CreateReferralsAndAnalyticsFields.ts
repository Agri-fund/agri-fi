import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * #1018 — Referral conversion funnel analytics.
 * Ensures referral tables exist and adds channel + payout_status for
 * per-channel funnel math and reward accrual timeline.
 */
export class CreateReferralsAndAnalyticsFields2060000000000
  implements MigrationInterface
{
  name = 'CreateReferralsAndAnalyticsFields2060000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "referral_codes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "code" character varying(8) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_referral_codes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_referral_codes_code" UNIQUE ("code"),
        CONSTRAINT "UQ_referral_codes_user_id" UNIQUE ("user_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_referral_codes_code" ON "referral_codes" ("code")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "referrals" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "referrer_id" uuid NOT NULL,
        "referee_id" uuid,
        "status" character varying NOT NULL DEFAULT 'clicked',
        "reward_amount" numeric(10,2) NOT NULL DEFAULT 0,
        "channel" character varying(64) NOT NULL DEFAULT 'unknown',
        "payout_status" character varying(32) NOT NULL DEFAULT 'pending',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_referrals" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "referrals"
        ADD COLUMN IF NOT EXISTS "channel" character varying(64) NOT NULL DEFAULT 'unknown'
    `);
    await queryRunner.query(`
      ALTER TABLE "referrals"
        ADD COLUMN IF NOT EXISTS "payout_status" character varying(32) NOT NULL DEFAULT 'pending'
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_referrals_referrer_id" ON "referrals" ("referrer_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_referrals_channel" ON "referrals" ("channel")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "referrals" DROP COLUMN IF EXISTS "payout_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "referrals" DROP COLUMN IF EXISTS "channel"`,
    );
  }
}
