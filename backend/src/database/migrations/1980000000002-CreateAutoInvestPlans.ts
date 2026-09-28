import { MigrationInterface, QueryRunner, Table, Index } from 'typeorm';

/**
 * Migration: #1001 – Creates the auto_invest_plans table.
 * Supports recurring dollar-cost-averaging for investors via a cron-driven
 * allocation pipeline.
 */
export class CreateAutoInvestPlans1980000000002 implements MigrationInterface {
  name = 'CreateAutoInvestPlans1980000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'auto_invest_plans',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'gen_random_uuid()' },
          { name: 'investor_id', type: 'uuid', isNullable: false },
          { name: 'amount_usd', type: 'decimal', precision: 36, scale: 7, isNullable: false },
          { name: 'cadence', type: 'varchar', length: '16', isNullable: false },
          { name: 'funding_wallet', type: 'varchar', length: '256', isNullable: false },
          { name: 'max_risk_score', type: 'decimal', precision: 5, scale: 2, default: 75, isNullable: false },
          { name: 'deal_type_filter', type: 'jsonb', isNullable: true, default: null },
          { name: 'status', type: 'varchar', length: '16', default: "'active'", isNullable: false },
          { name: 'daily_cap_usd', type: 'decimal', precision: 36, scale: 7, isNullable: true, default: null },
          { name: 'consecutive_failures', type: 'int', default: 0, isNullable: false },
          { name: 'next_run_at', type: 'timestamptz', isNullable: false },
          { name: 'last_run_at', type: 'timestamptz', isNullable: true, default: null },
          { name: 'created_at', type: 'timestamptz', default: 'now()', isNullable: false },
          { name: 'updated_at', type: 'timestamptz', default: 'now()', isNullable: false },
          { name: 'deleted_at', type: 'timestamptz', isNullable: true, default: null },
        ],
        foreignKeys: [
          {
            columnNames: ['investor_id'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
      true,
    );

    // Index for the cron query: active plans due for execution
    await queryRunner.createIndex(
      'auto_invest_plans',
      new Index({
        name: 'IDX_auto_invest_plans_next_run',
        columnNames: ['status', 'next_run_at'],
        where: `"deleted_at" IS NULL AND "status" = 'active'`,
      }),
    );

    // Index for investor plan listing
    await queryRunner.createIndex(
      'auto_invest_plans',
      new Index({
        name: 'IDX_auto_invest_plans_investor',
        columnNames: ['investor_id'],
        where: `"deleted_at" IS NULL`,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('auto_invest_plans', 'IDX_auto_invest_plans_investor');
    await queryRunner.dropIndex('auto_invest_plans', 'IDX_auto_invest_plans_next_run');
    await queryRunner.dropTable('auto_invest_plans');
  }
}
