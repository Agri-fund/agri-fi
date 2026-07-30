import { MigrationInterface, QueryRunner } from 'typeorm';

export class IndexTxLog1745000000001 implements MigrationInterface {
  name = 'IndexTxLog1745000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_tx_logs_user_status_created"
       ON "transaction_logs" ("user_id", "status", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_tx_logs_user_status_created"`,
    );
  }
}
