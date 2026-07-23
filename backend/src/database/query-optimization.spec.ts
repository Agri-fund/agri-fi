import { join } from 'path';
import { DataSource } from 'typeorm';

let dataSource: DataSource;

/** Index names from migration 1700000008-AddInvestmentIndexes */
const INDEXES = {
  investmentsTradeDealStatus: 'idx_investments_trade_deal_status',
  investmentsInvestorId: 'idx_investments_investor_id',
  shipmentMilestonesTradeDealId: 'idx_shipment_milestones_trade_deal_id',
  paymentDistributionsTradeDealId: 'idx_payment_distributions_trade_deal_id',
} as const;

/** Seeded in migration 1762000000000-SeedInitialData */
const SEED = {
  investorId: 'a0000000-0000-0000-0000-000000000003',
  tradeDealId: 'b0000000-0000-0000-0000-000000000001',
} as const;

/**
 * Returns the merged EXPLAIN (ANALYZE, BUFFERS) text plan.
 * Seq scans are disabled so the planner must use an index when one exists
 * (mirrors backend/scripts/verify-indexes.sql expectations).
 */
async function explainAnalyze(
  dataSource: DataSource,
  sql: string,
  parameters: unknown[] = [],
): Promise<string> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  try {
    await queryRunner.query('SET enable_seqscan = off');
    const rows: Array<Record<string, string>> = await queryRunner.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`,
      parameters,
    );
    return rows
      .map((row) => row['QUERY PLAN'] ?? Object.values(row)[0])
      .join('\n');
  } finally {
    await queryRunner.query('SET enable_seqscan = on');
    await queryRunner.release();
  }
}

function expectIndexScan(plan: string, indexName: string): void {
  expect(plan).toMatch(/Index (Only )?Scan|Bitmap Index Scan/i);
  expect(plan).toContain(indexName);
  expect(plan).not.toMatch(/Seq Scan on/i);
}

const describeWithDatabase = process.env.DATABASE_URL
  ? describe
  : describe.skip;

describeWithDatabase('Query planner optimizations (PostgreSQL)', () => {
  jest.setTimeout(120_000);

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
      migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
    await dataSource.query('ANALYZE investments');
    await dataSource.query('ANALYZE shipment_milestones');
    await dataSource.query('ANALYZE payment_distributions');
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('defines performance indexes for list-query tables', async () => {
    const rows: Array<{ indexname: string }> = await dataSource.query(
      `
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = ANY($1::text[])
      `,
      [Object.values(INDEXES)],
    );

    expect(rows.map((row) => row.indexname).sort()).toEqual(
      Object.values(INDEXES).sort(),
    );
  });

  it('uses composite index on trade_deal_id and status for availability checks', async () => {
    const plan = await explainAnalyze(
      dataSource,
      `
        SELECT *
        FROM investments
        WHERE trade_deal_id = $1::uuid
          AND status = $2
      `,
      [SEED.tradeDealId, 'confirmed'],
    );

    expectIndexScan(plan, INDEXES.investmentsTradeDealStatus);
  });

  it('uses investor_id index for investor investment list queries', async () => {
    const plan = await explainAnalyze(
      dataSource,
      `
        SELECT *
        FROM investments
        WHERE investor_id = $1::uuid
        ORDER BY created_at DESC
        LIMIT 20
      `,
      [SEED.investorId],
    );

    expectIndexScan(plan, INDEXES.investmentsInvestorId);
  });

  it('uses trade_deal_id index for paginated investments-by-deal list queries', async () => {
    const plan = await explainAnalyze(
      dataSource,
      `
        SELECT *
        FROM investments
        WHERE trade_deal_id = $1::uuid
        ORDER BY created_at DESC
        LIMIT 12 OFFSET 0
      `,
      [SEED.tradeDealId],
    );

    expectIndexScan(plan, INDEXES.investmentsTradeDealStatus);
  });

  it('uses trade_deal_id index for shipment milestone list queries', async () => {
    const plan = await explainAnalyze(
      dataSource,
      `
        SELECT *
        FROM shipment_milestones
        WHERE trade_deal_id = $1::uuid
        ORDER BY recorded_at ASC
      `,
      [SEED.tradeDealId],
    );

    expectIndexScan(plan, INDEXES.shipmentMilestonesTradeDealId);
  });

  it('uses trade_deal_id index for payment distribution list queries', async () => {
    const plan = await explainAnalyze(
      dataSource,
      `
        SELECT *
        FROM payment_distributions
        WHERE trade_deal_id = $1::uuid
      `,
      [SEED.tradeDealId],
    );

    expectIndexScan(plan, INDEXES.paymentDistributionsTradeDealId);
  });
});
