import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddMilestoneReleasePctToTradeDeal1950000000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'trade_deals',
      new TableColumn({
        name: 'milestone_release_pct',
        type: 'decimal',
        precision: 5,
        scale: 2,
        default: 0,
        isNullable: false,
        comment:
          'Percentage of 98% escrow pool to release per completed milestone (0 = release at completion only)',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('trade_deals', 'milestone_release_pct');
  }
}
