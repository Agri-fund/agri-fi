import { MigrationInterface, QueryRunner } from 'typeorm';

export class IndexTradeDealStatus1716300000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX idx_trade_deal_status ON trade_deal(status)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_trade_deal_status`);
  }
}
