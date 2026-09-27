import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the unrecognised_payments table to store incoming Stellar payments
 * that could not be matched to a pending investment.
 * Issue #905 — Stellar payment streaming
 */
export class CreateUnrecognisedPayments1980000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "unrecognised_payments" (
        "id"                 uuid              NOT NULL DEFAULT gen_random_uuid(),
        "tx_hash"            varchar           NOT NULL,
        "from_account"       varchar           NOT NULL,
        "amount"             varchar           NOT NULL,
        "asset_code"         varchar,
        "asset_issuer"       varchar,
        "memo"               text,
        "reason"             text              NOT NULL,
        "stellar_created_at" timestamptz,
        "created_at"         timestamptz       NOT NULL DEFAULT now(),
        CONSTRAINT "PK_unrecognised_payments" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_unrecognised_payments_tx_hash" UNIQUE ("tx_hash")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_unrecognised_payments_created_at"
        ON "unrecognised_payments" ("created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_unrecognised_payments_created_at"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "unrecognised_payments"`);
  }
}
