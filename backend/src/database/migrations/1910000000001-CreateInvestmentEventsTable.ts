import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInvestmentEventsTable1910000000001 implements MigrationInterface {
  name = 'CreateInvestmentEventsTable1910000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "investment_events" (
        "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "investment_id" UUID NOT NULL,
        "event_type"    VARCHAR(100) NOT NULL,
        "payload"       JSONB NOT NULL DEFAULT '{}'::jsonb,
        "actor_id"      UUID,
        "occurred_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_investment_events_investment_id" ON "investment_events" ("investment_id")`,
    );

    // Prevent updates or deletes on investment_events (immutable constraint)
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_investment_event_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'investment_events records are immutable and cannot be updated or deleted';
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      DROP TRIGGER IF EXISTS trg_investment_events_immutable ON "investment_events";
      CREATE TRIGGER trg_investment_events_immutable
      BEFORE UPDATE OR DELETE ON "investment_events"
      FOR EACH ROW EXECUTE FUNCTION prevent_investment_event_mutation();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_investment_events_immutable ON "investment_events"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS prevent_investment_event_mutation`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "investment_events"`);
  }
}
