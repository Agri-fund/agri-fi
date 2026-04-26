import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTransactionLogs1745000000000 implements MigrationInterface {
  name = 'CreateTransactionLogs1745000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "transaction_logs" (
        "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"    UUID REFERENCES users(id) ON DELETE SET NULL,
        "deal_id"    UUID REFERENCES trade_deals(id) ON DELETE SET NULL,
        "tx_hash"    TEXT,
        "xdr_body"   TEXT,
        "status"     TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'success', 'failed')),
        "error_code" TEXT,
        "created_at" TIMESTAMPTZ DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_tx_logs_user_id" ON "transaction_logs" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_tx_logs_deal_id" ON "transaction_logs" ("deal_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "transaction_logs"`);
  }
}
