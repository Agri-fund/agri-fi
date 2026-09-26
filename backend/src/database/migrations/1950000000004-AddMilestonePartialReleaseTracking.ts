import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class AddMilestonePartialReleaseTracking1950000000004 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'milestone_release_records',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'trade_deal_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'milestone_type',
            type: 'varchar',
            length: 16,
            isNullable: false,
            comment: 'Milestone type: farm, warehouse, port, importer',
          },
          {
            name: 'release_pct',
            type: 'decimal',
            precision: 5,
            scale: 2,
            isNullable: false,
            comment: 'Percentage released for this milestone',
          },
          {
            name: 'farmer_amount_usd',
            type: 'decimal',
            precision: 36,
            scale: 7,
            isNullable: false,
            comment: 'Amount distributed to farmer (part of 98% pool)',
          },
          {
            name: 'stellar_tx_id',
            type: 'varchar',
            isNullable: true,
            comment: 'Soroban transaction ID for this release',
          },
          {
            name: 'created_at',
            type: 'timestamp with time zone',
            default: 'now()',
            isNullable: false,
          },
        ],
        indices: [
          {
            name: 'idx_milestone_release_deal',
            columnNames: ['trade_deal_id'],
          },
          {
            name: 'idx_milestone_release_unique',
            columnNames: ['trade_deal_id', 'milestone_type'],
            isUnique: true,
          },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('milestone_release_records');
  }
}
