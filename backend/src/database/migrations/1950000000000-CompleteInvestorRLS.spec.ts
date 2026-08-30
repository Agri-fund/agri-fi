import { QueryRunner } from 'typeorm';
import { CompleteInvestorRLS1950000000000 } from './1950000000000-CompleteInvestorRLS';

describe('CompleteInvestorRLS1950000000000', () => {
  const migration = new CompleteInvestorRLS1950000000000();

  function createMockQueryRunner() {
    return { query: jest.fn().mockResolvedValue(undefined) } as unknown as QueryRunner;
  }

  it('creates a company context and policies for every investor-owned table', async () => {
    const queryRunner = createMockQueryRunner();
    await migration.up(queryRunner);

    const sql = (queryRunner.query as jest.Mock).mock.calls
      .map(([statement]) => statement as string)
      .join('\n');

    expect(sql).toContain('app.current_company_id');
    expect(sql).toContain('"company_id"');
    expect(sql).not.toContain('tenant_id');

    for (const table of [
      'users',
      'investments',
      'transaction_logs',
      'transaction_audit_log',
      'payment_distributions',
      'investment_events',
      'investor_email_sequences',
      'kyc_submissions',
      'notifications',
      'notification_preferences',
      'achievements',
      'login_logs',
      'audit_logs',
      'investments_archive',
      'secondary_trades',
      'account_merge_recovery',
    ]) {
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`CREATE POLICY "${table}_company_isolation"`);
      expect(sql).toContain('WITH CHECK');
    }
  });

  it('removes policies, helper function, and company column in down()', async () => {
    const queryRunner = createMockQueryRunner();
    await migration.down(queryRunner);

    const sql = (queryRunner.query as jest.Mock).mock.calls
      .map(([statement]) => statement as string)
      .join('\n');

    expect(sql).toContain('DROP FUNCTION IF EXISTS app.user_in_current_company(UUID)');
    expect(sql).toContain('ALTER TABLE "users" DROP COLUMN IF EXISTS "company_id"');
    expect(sql).toContain('DROP POLICY IF EXISTS "investments_company_isolation"');
  });
});
