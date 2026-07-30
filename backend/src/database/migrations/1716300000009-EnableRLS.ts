import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enables Row Level Security (RLS) on the `investments` and `transaction_logs`
 * tables and defines tenant-isolation policies that check the active tenant ID
 * stored in the PostgreSQL session variable `app.current_tenant_id`.
 *
 * Application code MUST call:
 *   SET LOCAL app.current_tenant_id = '<tenant-uuid>';
 * inside the same transaction/session before any DML on these tables.
 *
 * Skipped when `users.tenant_id` is not present (column not introduced yet).
 */
export class EnableRLS1716300000009 implements MigrationInterface {
  name = 'EnableRLS1716300000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tenantColumn = await queryRunner.query(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'tenant_id'
      LIMIT 1
    `);

    if (!tenantColumn.length) {
      // Tenant column is not in schema yet — record migration as applied without
      // installing broken policies that reference a missing column.
      return;
    }

    const txLogsExist = await queryRunner.query(`
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'transaction_logs'
      LIMIT 1
    `);

    // ------------------------------------------------------------------ //
    // investments
    // ------------------------------------------------------------------ //
    await queryRunner.query(
      `ALTER TABLE "investments" ENABLE ROW LEVEL SECURITY`,
    );

    await queryRunner.query(
      `ALTER TABLE "investments" FORCE ROW LEVEL SECURITY`,
    );

    await queryRunner.query(`
      CREATE POLICY "investments_tenant_isolation"
      ON "investments"
      USING (
        "investor_id" IN (
          SELECT id FROM users
          WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
        )
      )
    `);

    if (!txLogsExist.length) {
      return;
    }

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
