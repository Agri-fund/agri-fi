import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSep24Transactions1766000000000 implements MigrationInterface {
  name = 'CreateSep24Transactions1766000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "sep24_transactions" (
        "id" character varying NOT NULL,
        "stellar_account" character varying NOT NULL,
        "user_id" character varying,
        "kind" character varying(16) NOT NULL,
        "asset_code" character varying NOT NULL,
        "amount_in" character varying,
        "amount_out" character varying,
        "status" character varying(32) NOT NULL DEFAULT 'incomplete',
        "message" text,
        "dest" character varying,
        "dest_extra" character varying,
        "external_tx_id" character varying,
        "stellar_transaction_id" character varying,
        "started_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sep24_transactions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_sep24_transactions_stellar_account"
      ON "sep24_transactions" ("stellar_account")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_sep24_transactions_kind_status"
      ON "sep24_transactions" ("kind", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_sep24_transactions_kind_status"`);
    await queryRunner.query(
      `DROP INDEX "IDX_sep24_transactions_stellar_account"`,
    );
    await queryRunner.query(`DROP TABLE "sep24_transactions"`);
  }
}
