import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTxAuditLogs1716300000007 implements MigrationInterface {
  name = 'CreateTxAuditLogs1716300000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "transaction_audit_log" (
        "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"    UUID REFERENCES users(id) ON DELETE SET NULL,
        "tx_hash"    TEXT,
        "status"     TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'success', 'failed')),
        "error_code" TEXT,
        "amount"     NUMERIC(20, 7),
        "created_at" TIMESTAMPTZ DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "transaction_audit_log"`);
  }
}
