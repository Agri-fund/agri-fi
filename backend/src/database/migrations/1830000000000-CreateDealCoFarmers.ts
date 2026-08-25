import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration (#891): Create the deal_co_farmers join table.
 *
 * Allows multiple farmers to co-create a single deal (e.g. a farming
 * cooperative), where each co-farmer is responsible for a defined portion%
 * of the delivery and receives the matching share of the net payout.
 */
export class CreateDealCoFarmers1830000000000 implements MigrationInterface {
  name = 'CreateDealCoFarmers1830000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "deal_co_farmers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "trade_deal_id" uuid NOT NULL,
        "farmer_id" uuid NOT NULL,
        "portion_percent" numeric(5, 2) NOT NULL,
        "status" text NOT NULL DEFAULT 'invited',
        "invited_email" character varying,
        "invitation_token" character varying,
        "invitation_expires_at" TIMESTAMPTZ,
        "accepted_at" TIMESTAMPTZ,
        "declined_at" TIMESTAMPTZ,
        "invited_by" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_deal_co_farmers" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_deal_co_farmer" UNIQUE ("trade_deal_id", "farmer_id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_deal_co_farmers_deal" ON "deal_co_farmers" ("trade_deal_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_deal_co_farmers_farmer" ON "deal_co_farmers" ("farmer_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "deal_co_farmers"`);
  }
}
