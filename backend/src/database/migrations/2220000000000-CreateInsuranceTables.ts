import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInsuranceTables2220000000000 implements MigrationInterface {
  name = 'CreateInsuranceTables2220000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "insurance_quotes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "trade_deal_id" uuid NOT NULL REFERENCES "trade_deals"("id") ON DELETE CASCADE,
        "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
        "provider_id" varchar(64) NOT NULL,
        "provider_quote_id" varchar(255) NOT NULL,
        "coverage_type" varchar(32) NOT NULL CHECK ("coverage_type" IN ('crop_failure', 'shipment_damage', 'price_fluctuation')),
        "coverage_amount" numeric(18,2) NOT NULL CHECK ("coverage_amount" > 0),
        "premium" numeric(18,2) NOT NULL CHECK ("premium" >= 0),
        "currency" varchar(3) NOT NULL DEFAULT 'USD',
        "terms" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "risk_score" numeric(5,2) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'offered' CHECK ("status" IN ('offered', 'issuing', 'issued')),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_insurance_quotes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_insurance_quotes_provider_quote" UNIQUE ("provider_id", "provider_quote_id")
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_insurance_quotes_deal_status" ON "insurance_quotes" ("trade_deal_id", "status")',
    );

    await queryRunner.query(`
      CREATE TABLE "insurance_policies" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "quote_id" uuid NOT NULL,
        "trade_deal_id" uuid NOT NULL REFERENCES "trade_deals"("id") ON DELETE RESTRICT,
        "provider_id" varchar(64) NOT NULL,
        "provider_policy_id" varchar(255) NOT NULL,
        "policy_number" varchar(255),
        "coverage_type" varchar(32) NOT NULL,
        "coverage_amount" numeric(18,2) NOT NULL,
        "currency" varchar(3) NOT NULL DEFAULT 'USD',
        "contract" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "contract_hash" varchar(64) NOT NULL,
        "blockchain_tx_hash" varchar(64),
        "status" varchar(24) NOT NULL DEFAULT 'anchor_pending' CHECK ("status" IN ('anchor_pending', 'active', 'expired')),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_insurance_policies" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_insurance_policies_quote" UNIQUE ("quote_id"),
        CONSTRAINT "FK_insurance_policies_quote" FOREIGN KEY ("quote_id") REFERENCES "insurance_quotes"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_insurance_policies_deal_status" ON "insurance_policies" ("trade_deal_id", "status")',
    );

    await queryRunner.query(`
      CREATE TABLE "insurance_claims" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "policy_id" uuid NOT NULL REFERENCES "insurance_policies"("id") ON DELETE RESTRICT,
        "trade_deal_id" uuid NOT NULL REFERENCES "trade_deals"("id") ON DELETE RESTRICT,
        "provider_id" varchar(64) NOT NULL,
        "event_id" uuid NOT NULL,
        "event_type" varchar(32) NOT NULL,
        "amount" numeric(18,2) NOT NULL CHECK ("amount" > 0),
        "approved_amount" numeric(18,2),
        "evidence" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "provider_claim_id" varchar(255),
        "provider_payout_id" varchar(255),
        "payout_tx_hash" varchar(64),
        "status" varchar(24) NOT NULL DEFAULT 'submitted' CHECK ("status" IN ('submitted', 'submission_failed', 'approved', 'rejected', 'payout_pending', 'payout_processing', 'paid')),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_insurance_claims" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_insurance_claims_policy_event" UNIQUE ("policy_id", "event_id")
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_insurance_claims_provider_status_created" ON "insurance_claims" ("provider_id", "status", "created_at")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "insurance_claims"');
    await queryRunner.query('DROP TABLE "insurance_policies"');
    await queryRunner.query('DROP TABLE "insurance_quotes"');
  }
}
