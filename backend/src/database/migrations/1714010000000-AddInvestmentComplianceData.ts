import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvestmentComplianceData1714010000000 implements MigrationInterface {
  name = 'AddInvestmentComplianceData1714010000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "investments"
      ADD COLUMN "compliance_data" JSONB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "investments"
      DROP COLUMN "compliance_data"
    `);
  }
}
