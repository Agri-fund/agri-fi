import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration (#898): Create the security_ip_blocks table.
 *
 * Persists enforcement actions produced by credential-stuffing detection:
 * global per-email rate limits, CAPTCHA requirements and (pending/active)
 * /16 subnet blocks. Active blocks are mirrored into Redis for fast lookup
 * on the login hot path; this table is the auditable source of truth and
 * backs the admin endpoints to review/approve/lift blocks.
 */
export class CreateSecurityIpBlocks1850000000000 implements MigrationInterface {
  name = 'CreateSecurityIpBlocks1850000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "security_ip_blocks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "type" text NOT NULL,
        "cidr" text NOT NULL,
        "reason" text NOT NULL,
        "metadata" jsonb,
        "approved_by" uuid,
        "expires_at" TIMESTAMPTZ,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_security_ip_blocks" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_security_ip_blocks_type" ON "security_ip_blocks" ("type")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_security_ip_blocks_cidr" ON "security_ip_blocks" ("cidr")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "security_ip_blocks"`);
  }
}
