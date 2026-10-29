import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateZkpProofsTable2060000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "zkp_proofs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_id" varchar NOT NULL,
        "credential_type" varchar(64) NOT NULL,
        "proof_payload" text NOT NULL,
        "public_inputs" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "circuit_id" varchar(128) NOT NULL,
        "standard" varchar(32) NOT NULL DEFAULT 'groth16',
        "status" varchar(32) NOT NULL DEFAULT 'pending',
        "credential_commitment" varchar(64) NOT NULL,
        "stellar_tx_id" varchar(128),
        "expires_at" TIMESTAMP WITH TIME ZONE,
        "revocation_reason" text,
        "generation_time_ms" integer,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_zkp_proofs_id" PRIMARY KEY ("id")
      );
      CREATE INDEX "idx_zkp_proofs_owner_type" ON "zkp_proofs" ("owner_id", "credential_type");
      CREATE INDEX "idx_zkp_proofs_status" ON "zkp_proofs" ("status");
      CREATE INDEX "IDX_zkp_proofs_owner_id" ON "zkp_proofs" ("owner_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "zkp_proofs"`);
  }
}
