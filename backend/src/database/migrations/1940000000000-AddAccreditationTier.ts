import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccreditationTier1940000000000 implements MigrationInterface {
  name = 'AddAccreditationTier1940000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum for accreditation tier
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE accreditation_tier_enum AS ENUM ('retail', 'accredited', 'institutional');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    // Add accreditation columns to users
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "accreditation_tier" accreditation_tier_enum NOT NULL DEFAULT 'retail',
        ADD COLUMN IF NOT EXISTS "accreditation_expires_at" TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS "accreditation_document_url" TEXT,
        ADD COLUMN IF NOT EXISTS "accreditation_status" TEXT NOT NULL DEFAULT 'none'
          CONSTRAINT "chk_users_accreditation_status"
          CHECK (accreditation_status IN ('none', 'pending', 'approved', 'expired'));
    `);

    // Create enum for minimum tier on trade deals
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE minimum_tier_enum AS ENUM ('retail', 'accredited', 'institutional');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    // Add minimum_tier to trade_deals
    await queryRunner.query(`
      ALTER TABLE "trade_deals"
        ADD COLUMN IF NOT EXISTS "minimum_tier" minimum_tier_enum NOT NULL DEFAULT 'retail';
    `);

    // Create annual_investment_caps table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "annual_investment_caps" (
        "id"             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"        UUID         NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "year"           INT          NOT NULL,
        "total_invested" DECIMAL(36,7) NOT NULL DEFAULT 0,
        "updated_at"     TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "uq_annual_cap_user_year" UNIQUE ("user_id", "year")
      );
    `);

    // Create accreditation_review_queue table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "accreditation_review_queue" (
        "id"             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"        UUID        NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "tier_requested" TEXT        NOT NULL,
        "document_url"   TEXT,
        "status"         TEXT        NOT NULL DEFAULT 'pending',
        "reviewed_by"    UUID,
        "reviewed_at"    TIMESTAMPTZ,
        "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "accreditation_review_queue";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "annual_investment_caps";`);

    await queryRunner.query(`
      ALTER TABLE "trade_deals"
        DROP COLUMN IF EXISTS "minimum_tier";
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS minimum_tier_enum;`);

    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "accreditation_status",
        DROP COLUMN IF EXISTS "accreditation_document_url",
        DROP COLUMN IF EXISTS "accreditation_expires_at",
        DROP COLUMN IF EXISTS "accreditation_tier";
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS accreditation_tier_enum;`);
  }
}
