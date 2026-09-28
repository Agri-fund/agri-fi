import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * #902 — Investor accreditation tier management.
 *
 * Changes:
 *  - Creates the `accreditation_tier` PostgreSQL enum type
 *  - Adds `accreditation_tier` column to `users` (default: 'retail')
 *  - Adds `accreditation_status` column to `users` (pending/approved/rejected/expired)
 *  - Adds `accreditation_submitted_at`, `accreditation_approved_at`,
 *    `accreditation_expires_at`, `accreditation_document_url` columns
 *  - Adds `minimum_tier` column to `trade_deals` (default: 'retail')
 *  - Creates `annual_investment_totals` table for per-investor, per-year caps
 */
export class AddAccreditationTier1960000000000 implements MigrationInterface {
  name = 'AddAccreditationTier1960000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- ENUM types ---
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE accreditation_tier AS ENUM ('retail', 'accredited', 'institutional');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE accreditation_status AS ENUM ('none', 'pending', 'approved', 'rejected', 'expired');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // --- Users columns ---
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "accreditation_tier"
          accreditation_tier NOT NULL DEFAULT 'retail',
        ADD COLUMN IF NOT EXISTS "accreditation_status"
          accreditation_status NOT NULL DEFAULT 'none',
        ADD COLUMN IF NOT EXISTS "accreditation_submitted_at"
          timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "accreditation_approved_at"
          timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "accreditation_expires_at"
          timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "accreditation_document_url"
          text NULL,
        ADD COLUMN IF NOT EXISTS "accreditation_declaration"
          text NULL,
        ADD COLUMN IF NOT EXISTS "accreditation_rejection_reason"
          text NULL;
    `);

    // --- Trade deals minimum_tier column ---
    await queryRunner.query(`
      ALTER TABLE "trade_deals"
        ADD COLUMN IF NOT EXISTS "minimum_tier"
          accreditation_tier NOT NULL DEFAULT 'retail';
    `);

    // --- Annual investment cap tracking table ---
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "annual_investment_totals" (
        "id"          uuid          NOT NULL DEFAULT gen_random_uuid(),
        "investor_id" uuid          NOT NULL,
        "year"        integer       NOT NULL,
        "total_usd"   decimal(36,7) NOT NULL DEFAULT 0,
        "updated_at"  timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_annual_investment_totals" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_annual_investment_totals_investor_year"
          UNIQUE ("investor_id", "year"),
        CONSTRAINT "FK_annual_investment_totals_investor"
          FOREIGN KEY ("investor_id") REFERENCES "users"("id")
          ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_annual_investment_totals_investor_year"
        ON "annual_investment_totals" ("investor_id", "year");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "annual_investment_totals";`);

    await queryRunner.query(`
      ALTER TABLE "trade_deals"
        DROP COLUMN IF EXISTS "minimum_tier";
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "accreditation_rejection_reason",
        DROP COLUMN IF EXISTS "accreditation_declaration",
        DROP COLUMN IF EXISTS "accreditation_document_url",
        DROP COLUMN IF EXISTS "accreditation_expires_at",
        DROP COLUMN IF EXISTS "accreditation_approved_at",
        DROP COLUMN IF EXISTS "accreditation_submitted_at",
        DROP COLUMN IF EXISTS "accreditation_status",
        DROP COLUMN IF EXISTS "accreditation_tier";
    `);

    await queryRunner.query(`DROP TYPE IF EXISTS accreditation_status;`);
    await queryRunner.query(`DROP TYPE IF EXISTS accreditation_tier;`);
  }
}
