import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProcessedSorobanEvents1950000000001 implements MigrationInterface {
  name = 'CreateProcessedSorobanEvents1950000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "processed_soroban_events" (
        "id"               VARCHAR PRIMARY KEY,
        "contractId"       VARCHAR NOT NULL,
        "transactionHash"  VARCHAR NOT NULL,
        "ledger"           INTEGER NOT NULL,
        "eventType"        VARCHAR NOT NULL,
        "processedAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_processed_soroban_events_contract" ON "processed_soroban_events" ("contractId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_processed_soroban_events_ledger" ON "processed_soroban_events" ("ledger")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "processed_soroban_events"`);
  }
}
