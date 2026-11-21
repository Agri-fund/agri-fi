import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLetterOfCredit2250000000000 implements MigrationInterface {
  name = 'CreateLetterOfCredit2250000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "letter_of_credit" (
        "id" VARCHAR PRIMARY KEY,
        "deal_id" VARCHAR NOT NULL,
        "status" VARCHAR NOT NULL,
        "data" JSONB NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "IDX_letter_of_credit_deal_id" ON "letter_of_credit" ("deal_id");
      CREATE INDEX IF NOT EXISTS "IDX_letter_of_credit_status" ON "letter_of_credit" ("status");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "letter_of_credit"`);
  }
}
