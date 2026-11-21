import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvestmentUserStatusIndex1715000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_investments_user_status" ON "investments" ("investor_id", "status")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_investments_user_status"`);
  }
}
