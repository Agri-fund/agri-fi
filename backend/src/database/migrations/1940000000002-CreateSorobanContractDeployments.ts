import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tracks Soroban contract deployments and upgrade history (#901).
 */
export class CreateSorobanContractDeployments1940000000002 implements MigrationInterface {
  name = 'CreateSorobanContractDeployments1940000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "soroban_contract_deployments" (
        "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "contract_name"       VARCHAR(128) NOT NULL,
        "network_passphrase"  VARCHAR(64) NOT NULL,
        "contract_id"         VARCHAR(56) NOT NULL,
        "wasm_hash"           VARCHAR(64) NOT NULL,
        "previous_wasm_hash"  VARCHAR(64) NULL,
        "deployed_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "deployed_by"         UUID NULL REFERENCES "users"("id"),
        "status"              VARCHAR(32) NOT NULL DEFAULT 'active',
        "upgrade_plan_id"     UUID NULL,
        "verified_at"         TIMESTAMPTZ NULL,
        "smoke_test_passed"   BOOLEAN NULL,
        "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_soroban_deployments_contract"
      ON "soroban_contract_deployments" ("contract_name", "network_passphrase")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_soroban_deployments_status"
      ON "soroban_contract_deployments" ("status")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "soroban_upgrade_plans" (
        "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "contract_name"       VARCHAR(128) NOT NULL,
        "network_passphrase"  VARCHAR(64) NOT NULL,
        "contract_id"         VARCHAR(56) NOT NULL,
        "new_wasm_hash"       VARCHAR(64) NOT NULL,
        "previous_wasm_hash"  VARCHAR(64) NOT NULL,
        "new_wasm_path"       VARCHAR(512) NOT NULL,
        "status"              VARCHAR(32) NOT NULL DEFAULT 'planned',
        "planned_by"          UUID NOT NULL REFERENCES "users"("id"),
        "executed_at"         TIMESTAMPTZ NULL,
        "state_snapshot"      JSONB NULL,
        "testnet_validated"   BOOLEAN NOT NULL DEFAULT false,
        "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "soroban_upgrade_approvals" (
        "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "upgrade_plan_id" UUID NOT NULL REFERENCES "soroban_upgrade_plans"("id") ON DELETE CASCADE,
        "admin_id"        UUID NOT NULL REFERENCES "users"("id"),
        "signature"       VARCHAR(512) NOT NULL,
        "approved_at"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE ("upgrade_plan_id", "admin_id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "soroban_upgrade_approvals"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "soroban_upgrade_plans"`);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "soroban_contract_deployments"`,
    );
  }
}
