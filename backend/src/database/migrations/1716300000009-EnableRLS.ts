import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enables Row Level Security (RLS) on the `investments` and `transaction_logs`
 * tables. CompleteInvestorRLS1950000000000 adds the company context and
 * policies after all investor-owned tables have been created.
 */
export class EnableRLS1716300000009 implements MigrationInterface {
  name = 'EnableRLS1716300000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------------ //
    // investments
    // ------------------------------------------------------------------ //
    await queryRunner.query(
      `ALTER TABLE "investments" ENABLE ROW LEVEL SECURITY`,
    );

    // Bypass RLS for superusers / migration runner (FORCE applies to owners too)
    await queryRunner.query(
      `ALTER TABLE "investments" FORCE ROW LEVEL SECURITY`,
    );

    // ------------------------------------------------------------------ //
    // transaction_logs
    // ------------------------------------------------------------------ //
    await queryRunner.query(
      `ALTER TABLE "transaction_logs" ENABLE ROW LEVEL SECURITY`,
    );

    await queryRunner.query(
      `ALTER TABLE "transaction_logs" FORCE ROW LEVEL SECURITY`,
    );

    await queryRunner.query(`
      CREATE POLICY "transaction_logs_tenant_isolation"
      ON "transaction_logs"
      USING (
        "user_id" IN (
          SELECT id FROM users
          WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP POLICY IF EXISTS "transaction_logs_tenant_isolation" ON "transaction_logs"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transaction_logs" DISABLE ROW LEVEL SECURITY`,
    );

    await queryRunner.query(
      `DROP POLICY IF EXISTS "investments_tenant_isolation" ON "investments"`,
    );
    await queryRunner.query(
      `ALTER TABLE "investments" DISABLE ROW LEVEL SECURITY`,
    );
  }
}
