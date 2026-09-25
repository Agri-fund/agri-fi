import { MigrationInterface, QueryRunner, Table, TableColumn } from 'typeorm';

export class AddFarmerCreditScoring1715000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasColumn = await queryRunner.hasColumn('users', 'credit_score');
    if (!hasColumn) {
      await queryRunner.addColumn(
        'users',
        new TableColumn({
          name: 'credit_score',
          type: 'int',
          isNullable: true,
        }),
      );
    }

    const hasTable = await queryRunner.hasTable('farmer_credit_score_history');
    if (!hasTable) {
      await queryRunner.createTable(
        new Table({
          name: 'farmer_credit_score_history',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              generationStrategy: 'uuid',
              default: 'uuid_generate_v4()',
            },
            {
              name: 'user_id',
              type: 'uuid',
            },
            {
              name: 'score',
              type: 'int',
            },
            {
              name: 'max_deal_size_usdc',
              type: 'decimal',
              precision: 12,
              scale: 2,
            },
            {
              name: 'factors',
              type: 'jsonb',
            },
            {
              name: 'reason',
              type: 'varchar',
              length: '255',
            },
            {
              name: 'override_by',
              type: 'uuid',
              isNullable: true,
            },
            {
              name: 'created_at',
              type: 'timestamp with time zone',
              default: 'CURRENT_TIMESTAMP',
            },
          ],
        }),
        true,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('farmer_credit_score_history', true);
    await queryRunner.dropColumn('users', 'credit_score');
  }
}
