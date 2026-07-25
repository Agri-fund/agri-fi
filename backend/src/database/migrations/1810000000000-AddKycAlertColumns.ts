import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKycAlertColumns1810000000000 implements MigrationInterface {
  name = 'AddKycAlertColumns1810000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kyc_submissions" 
      ADD COLUMN "alert_30_sent_at" TIMESTAMPTZ,
      ADD COLUMN "alert_15_sent_at" TIMESTAMPTZ,
      ADD COLUMN "alert_3_sent_at" TIMESTAMPTZ;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kyc_submissions" 
      DROP COLUMN "alert_30_sent_at",
      DROP COLUMN "alert_15_sent_at",
      DROP COLUMN "alert_3_sent_at";
    `);
  }
}
