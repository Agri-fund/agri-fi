import { MigrationInterface, QueryRunner } from 'typeorm';

export class IndexTxLog1716300000006 implements MigrationInterface {
  name = 'IndexTxLog1716300000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "idx_tx_logs_user_status_created"
       ON "transaction_logs" ("user_id", "status", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_tx_logs_user_status_created"`,
    );
  }
}
