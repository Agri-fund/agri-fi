import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * #1019 — Country-level KYC rules matrix (document types per jurisdiction).
 */
export class CreateKycJurisdictionRules2060000000001
  implements MigrationInterface
{
  name = 'CreateKycJurisdictionRules2060000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "kyc_customer_type_enum" AS ENUM ('individual', 'corporate')
    `);

    await queryRunner.query(`
      CREATE TABLE "kyc_jurisdiction_rules" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "country_code" character varying(2) NOT NULL,
        "customer_type" "kyc_customer_type_enum" NOT NULL DEFAULT 'individual',
        "required_documents" jsonb NOT NULL DEFAULT '[]',
        "accepted_id_types" jsonb NOT NULL DEFAULT '[]',
        "id_number_pattern" character varying(128),
        "requires_proof_of_address" boolean NOT NULL DEFAULT true,
        "requires_selfie" boolean NOT NULL DEFAULT true,
        "max_document_age_days" integer,
        "document_expiry_required" boolean NOT NULL DEFAULT true,
        "is_active" boolean NOT NULL DEFAULT true,
        "version" integer NOT NULL DEFAULT 1,
        "change_reason" text,
        "created_by" uuid,
        "updated_by" uuid,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kyc_jurisdiction_rules" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_kyc_jurisdiction_country_type_version"
          UNIQUE ("country_code", "customer_type", "version")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_kyc_jurisdiction_country" ON "kyc_jurisdiction_rules" ("country_code")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kyc_jurisdiction_active" ON "kyc_jurisdiction_rules" ("is_active")`,
    );

    // Seed common jurisdictions used by the platform
    const seeds: Array<{
      country: string;
      type: string;
      docs: string;
      ids: string;
      pattern: string | null;
      poa: boolean;
      selfie: boolean;
    }> = [
      {
        country: 'NG',
        type: 'individual',
        docs: '["government_id_front","government_id_back","proof_of_address","selfie"]',
        ids: '["national_id","passport","drivers_license"]',
        pattern: '^[A-Z0-9]{6,20}$',
        poa: true,
        selfie: true,
      },
      {
        country: 'NG',
        type: 'corporate',
        docs: '["business_license","articles_of_incorporation","proof_of_address"]',
        ids: '["cac_registration"]',
        pattern: '^RC[0-9]{5,10}$',
        poa: true,
        selfie: false,
      },
      {
        country: 'KE',
        type: 'individual',
        docs: '["government_id_front","government_id_back","proof_of_address","selfie"]',
        ids: '["national_id","passport"]',
        pattern: '^[0-9]{6,10}$',
        poa: true,
        selfie: true,
      },
      {
        country: 'GH',
        type: 'individual',
        docs: '["government_id_front","proof_of_address","selfie"]',
        ids: '["ghana_card","passport"]',
        pattern: '^[A-Z]{3}-[0-9]{9}-[0-9]$',
        poa: true,
        selfie: true,
      },
      {
        country: 'US',
        type: 'individual',
        docs: '["government_id_front","government_id_back","proof_of_address","selfie"]',
        ids: '["drivers_license","passport","state_id"]',
        pattern: '^[A-Z0-9-]{5,20}$',
        poa: true,
        selfie: true,
      },
      {
        country: 'GB',
        type: 'individual',
        docs: '["government_id_front","proof_of_address","selfie"]',
        ids: '["passport","drivers_license"]',
        pattern: '^[A-Z0-9]{6,12}$',
        poa: true,
        selfie: true,
      },
    ];

    for (const seed of seeds) {
      await queryRunner.query(
        `
        INSERT INTO "kyc_jurisdiction_rules"
          ("country_code","customer_type","required_documents","accepted_id_types",
           "id_number_pattern","requires_proof_of_address","requires_selfie",
           "document_expiry_required","is_active","version","change_reason")
        VALUES
          ($1, $2::kyc_customer_type_enum, $3::jsonb, $4::jsonb, $5, $6, $7, true, true, 1, 'Initial seed')
        `,
        [
          seed.country,
          seed.type,
          seed.docs,
          seed.ids,
          seed.pattern,
          seed.poa,
          seed.selfie,
        ],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "kyc_jurisdiction_rules"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "kyc_customer_type_enum"`);
  }
}
