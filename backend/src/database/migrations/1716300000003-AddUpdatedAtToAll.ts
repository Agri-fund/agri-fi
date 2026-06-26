import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUpdatedAtToAll1716300000003 implements MigrationInterface {
  name = 'AddUpdatedAtToAll1716300000003';

  private readonly tables = [
    'users',
    'trade_deals',
    'documents',
    'investments',
    'shipment_milestones',
    'payment_distributions',
    'kyc_submissions',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the shared trigger function once
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    for (const table of this.tables) {
      await queryRunner.query(`
        ALTER TABLE "${table}"
          ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ DEFAULT now()
      `);

      await queryRunner.query(`
        CREATE TRIGGER "trg_${table}_updated_at"
        BEFORE UPDATE ON "${table}"
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of this.tables) {
      await queryRunner.query(
        `DROP TRIGGER IF EXISTS "trg_${table}_updated_at" ON "${table}"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "updated_at"`,
      );
    }

    await queryRunner.query(`DROP FUNCTION IF EXISTS set_updated_at()`);
  }
}
