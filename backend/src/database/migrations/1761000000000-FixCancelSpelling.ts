import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixCancelSpelling1761000000000 implements MigrationInterface {
  name = 'FixCancelSpelling1761000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Update any existing 'canceled' status to 'cancelled' for consistency
    await queryRunner.query(`
      UPDATE trade_deals 
      SET status = 'cancelled' 
      WHERE status = 'canceled'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert back to 'canceled' if needed
    await queryRunner.query(`
      UPDATE trade_deals 
      SET status = 'canceled' 
      WHERE status = 'cancelled'
    `);
  }
}
