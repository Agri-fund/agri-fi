import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Establishes the company boundary used by investor-data RLS policies.
 * The authenticated application transaction must set:
 *   SET LOCAL app.current_company_id = '<company-uuid>';
 */
export class CompleteInvestorRLS1950000000000 implements MigrationInterface {
  name = 'CompleteInvestorRLS1950000000000';

  private readonly policies: Array<{ table: string; predicate: string }> = [
    { table: 'investments', predicate: 'app.user_in_current_company("investor_id")' },
    { table: 'transaction_logs', predicate: 'app.user_in_current_company("user_id")' },
    { table: 'transaction_audit_log', predicate: 'app.user_in_current_company("user_id")' },
    { table: 'payment_distributions', predicate: 'app.user_in_current_company("recipient_id")' },
    {
      table: 'investment_events',
      predicate: 'EXISTS (SELECT 1 FROM investments i WHERE i.id = "investment_events"."investment_id" AND app.user_in_current_company(i.investor_id))',
    },
    { table: 'investor_email_sequences', predicate: 'app.user_in_current_company("user_id")' },
    { table: 'kyc_submissions', predicate: 'app.user_in_current_company("user_id")' },
    { table: 'notifications', predicate: 'app.user_in_current_company("user_id")' },
    { table: 'notification_preferences', predicate: 'app.user_in_current_company("user_id")' },
    { table: 'achievements', predicate: 'app.user_in_current_company("user_id")' },
    { table: 'login_logs', predicate: 'app.user_in_current_company("user_id")' },
    { table: 'audit_logs', predicate: 'app.user_in_current_company("user_id")' },
    { table: 'investments_archive', predicate: 'app.user_in_current_company("investor_id")' },
    {
      table: 'secondary_trades',
      predicate: 'app.user_in_current_company("seller_id") OR app.user_in_current_company("buyer_id")',
    },
    { table: 'account_merge_recovery', predicate: 'app.user_in_current_company("original_investor_id")' },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "company_id" UUID`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_users_company_id" ON "users" ("company_id")`);

    await queryRunner.query(`
      CREATE SCHEMA IF NOT EXISTS app;
      CREATE OR REPLACE FUNCTION app.user_in_current_company(target_user_id UUID)
      RETURNS BOOLEAN
      LANGUAGE SQL
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $$
        SELECT target_user_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM users
            WHERE users.id = target_user_id
              AND users.company_id = NULLIF(current_setting('app.current_company_id', true), '')::UUID
          );
      $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS "users_company_isolation" ON "users";
      CREATE POLICY "users_company_isolation" ON "users"
        USING ("company_id" = NULLIF(current_setting('app.current_company_id', true), '')::UUID)
        WITH CHECK ("company_id" = NULLIF(current_setting('app.current_company_id', true), '')::UUID);
    `);

    for (const { table, predicate } of this.policies) {
      await queryRunner.query(`
        ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;
        ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "${table}_company_isolation" ON "${table}";
        CREATE POLICY "${table}_company_isolation" ON "${table}"
          USING (${predicate})
          WITH CHECK (${predicate});
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { table } of [...this.policies].reverse()) {
      await queryRunner.query(`DROP POLICY IF EXISTS "${table}_company_isolation" ON "${table}"`);
      await queryRunner.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
    }

    await queryRunner.query(`DROP POLICY IF EXISTS "users_company_isolation" ON "users"`);
    await queryRunner.query(`ALTER TABLE "users" DISABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS app.user_in_current_company(UUID)`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS app`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_users_company_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "company_id"`);
  }
}
