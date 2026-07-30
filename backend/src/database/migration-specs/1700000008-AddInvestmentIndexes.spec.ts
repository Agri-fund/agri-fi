import { QueryRunner } from 'typeorm';
import { AddInvestmentIndexes1700000008000 } from '../migrations/1700000008-AddInvestmentIndexes';

/**
 * Guards the investment.investor_id index (issue #299) at the migration-
 * source level, without requiring a live Postgres connection. The full
 * end-to-end proof — that the index exists AND the query planner actually
 * uses it for investor portfolio lookups — lives in
 * `../query-optimization.spec.ts`, but that suite only runs when
 * DATABASE_URL is set. This test always runs, so a future edit that
 * accidentally drops or renames the investor_id index is still caught.
 */
describe('AddInvestmentIndexes1700000008000', () => {
  const migration = new AddInvestmentIndexes1700000008000();

  function createMockQueryRunner() {
    return {
      query: jest.fn().mockResolvedValue(undefined),
    } as unknown as QueryRunner;
  }

  function findCall(
    queryRunner: QueryRunner,
    pattern: RegExp,
  ): string | undefined {
    const calls = (queryRunner.query as jest.Mock).mock.calls as [
      string,
      ...unknown[],
    ][];
    const match = calls.find(([sql]) => pattern.test(sql));
    return match?.[0];
  }

  it('creates an index on investments(investor_id) in up()', async () => {
    const queryRunner = createMockQueryRunner();

    await migration.up(queryRunner);

    const sql = findCall(queryRunner, /idx_investments_investor_id/i);
    expect(sql).toBeDefined();
    expect(sql).toMatch(/CREATE INDEX/i);
    expect(sql).toMatch(/"investments"/);
    expect(sql).toMatch(/"investor_id"/);
  });

  it('drops the investor_id index in down()', async () => {
    const queryRunner = createMockQueryRunner();

    await migration.down(queryRunner);

    const sql = findCall(queryRunner, /idx_investments_investor_id/i);
    expect(sql).toBeDefined();
    expect(sql).toMatch(/DROP INDEX/i);
  });

  it('drops the investor_id index before the composite index it depends on ordering-wise', async () => {
    const queryRunner = createMockQueryRunner();

    await migration.down(queryRunner);

    const calls = (queryRunner.query as jest.Mock).mock.calls as [string][];
    const investorIdDropIndex = calls.findIndex(([sql]) =>
      /idx_investments_investor_id/i.test(sql),
    );
    const compositeDropIndex = calls.findIndex(([sql]) =>
      /idx_investments_trade_deal_status/i.test(sql),
    );

    expect(investorIdDropIndex).toBeGreaterThanOrEqual(0);
    expect(compositeDropIndex).toBeGreaterThanOrEqual(0);
    // down() should be the exact reverse of up(): trade_deal_status was
    // created first, so it must be dropped last.
    expect(investorIdDropIndex).toBeLessThan(compositeDropIndex);
  });
});
