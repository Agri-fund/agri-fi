import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFeeConfigurations1830000000000 implements MigrationInterface {
  name = 'CreateFeeConfigurations1830000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum for fee types
    await queryRunner.query(`
      CREATE TYPE "fee_type_enum" AS ENUM (
        'platform_origination',
        'platform_success',
        'investor_entry',
        'early_exit'
      )
    `);

    // Create enum for investor tiers
    await queryRunner.query(`
      CREATE TYPE "investor_tier_enum" AS ENUM (
        'retail',
        'vip',
        'institutional'
      )
    `);

    // Create fee_configurations table
    await queryRunner.query(`
      CREATE TABLE "fee_configurations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "deal_type" character varying(100) NOT NULL,
        "investor_tier" "investor_tier_enum" NOT NULL DEFAULT 'retail',
        "fee_type" "fee_type_enum" NOT NULL,
        "rate_percent" numeric(5, 3) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
        "description" text,
        "effective_from" TIMESTAMPTZ NOT NULL,
        "effective_to" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fee_configurations" PRIMARY KEY ("id"),
        CONSTRAINT "UC_fee_config_unique" UNIQUE ("deal_type", "investor_tier", "fee_type", "effective_from")
      )
    `);

    // Create indexes for fast lookups
    await queryRunner.query(
      `CREATE INDEX "idx_fee_config_deal_type" ON "fee_configurations" ("deal_type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_fee_config_investor_tier" ON "fee_configurations" ("investor_tier")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_fee_config_fee_type" ON "fee_configurations" ("fee_type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_fee_config_effective" ON "fee_configurations" ("effective_from", "effective_to")`,
    );

    // Seed initial fee configurations (migrating from hard-coded 2% platform fee)
    const now = new Date().toISOString();
    const seedDate = '2024-01-01T00:00:00Z';

    // Seed data for all commodity types with current 2% platform origination fee
    const commodities = [
      'Cocoa',
      'Coffee',
      'Maize',
      'Rice',
      'Soybeans',
      'Wheat',
      'Cassava',
      'Tea',
      'Sesame',
      'Cashew',
    ];
    const tiers = ['retail', 'vip', 'institutional'];

    // Platform origination fee: 2% for all (migrating existing behavior)
    for (const commodity of commodities) {
      for (const tier of tiers) {
        await queryRunner.query(
          `
          INSERT INTO "fee_configurations" 
          ("deal_type", "investor_tier", "fee_type", "rate_percent", "description", "effective_from", "created_at", "updated_at")
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
          [
            commodity,
            tier,
            'platform_origination',
            2.0,
            `Platform origination fee for ${commodity} deals`,
            seedDate,
            now,
            now,
          ],
        );
      }
    }

    // Platform success fee: 0.5% for all (new feature)
    for (const commodity of commodities) {
      for (const tier of tiers) {
        await queryRunner.query(
          `
          INSERT INTO "fee_configurations" 
          ("deal_type", "investor_tier", "fee_type", "rate_percent", "description", "effective_from", "created_at", "updated_at")
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
          [
            commodity,
            tier,
            'platform_success',
            0.5,
            `Platform success fee for ${commodity} deals`,
            seedDate,
            now,
            now,
          ],
        );
      }
    }

    // Investor entry fee: tiered by investor tier
    for (const commodity of commodities) {
      // Retail: 1%
      await queryRunner.query(
        `
        INSERT INTO "fee_configurations" 
        ("deal_type", "investor_tier", "fee_type", "rate_percent", "description", "effective_from", "created_at", "updated_at")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
        [
          commodity,
          'retail',
          'investor_entry',
          1.0,
          `Investor entry fee (retail) for ${commodity} deals`,
          seedDate,
          now,
          now,
        ],
      );

      // VIP: 0.5%
      await queryRunner.query(
        `
        INSERT INTO "fee_configurations" 
        ("deal_type", "investor_tier", "fee_type", "rate_percent", "description", "effective_from", "created_at", "updated_at")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
        [
          commodity,
          'vip',
          'investor_entry',
          0.5,
          `Investor entry fee (VIP) for ${commodity} deals`,
          seedDate,
          now,
          now,
        ],
      );

      // Institutional: 0%
      await queryRunner.query(
        `
        INSERT INTO "fee_configurations" 
        ("deal_type", "investor_tier", "fee_type", "rate_percent", "description", "effective_from", "created_at", "updated_at")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
        [
          commodity,
          'institutional',
          'investor_entry',
          0.0,
          `Investor entry fee (institutional) for ${commodity} deals`,
          seedDate,
          now,
          now,
        ],
      );
    }

    // Early exit fee: 2% flat for all
    for (const commodity of commodities) {
      for (const tier of tiers) {
        await queryRunner.query(
          `
          INSERT INTO "fee_configurations" 
          ("deal_type", "investor_tier", "fee_type", "rate_percent", "description", "effective_from", "created_at", "updated_at")
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
          [
            commodity,
            tier,
            'early_exit',
            2.0,
            `Early exit penalty fee for ${commodity} deals`,
            seedDate,
            now,
            now,
          ],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop table
    await queryRunner.query(`DROP TABLE IF EXISTS "fee_configurations"`);

    // Drop enums
    await queryRunner.query(`DROP TYPE IF EXISTS "fee_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "investor_tier_enum"`);
  }
}
