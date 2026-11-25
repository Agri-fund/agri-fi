import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEddRequiredKycStatus2203000000000 implements MigrationInterface {
  name = 'AddEddRequiredKycStatus2203000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "kyc_edd_reason" text;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "kyc_edd_triggered_at" timestamptz;
      ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_kyc_status_check";
      ALTER TABLE "users" ADD CONSTRAINT "users_kyc_status_check"
        CHECK (kyc_status IN ('pending', 'verified', 'rejected', 'expired', 'EDD_REQUIRED'));
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "users" SET "kyc_status" = 'pending' WHERE "kyc_status" = 'EDD_REQUIRED';
      ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_kyc_status_check";
      ALTER TABLE "users" ADD CONSTRAINT "users_kyc_status_check"
        CHECK (kyc_status IN ('pending', 'verified', 'rejected', 'expired'));
      ALTER TABLE "users" DROP COLUMN IF EXISTS "kyc_edd_reason";
      ALTER TABLE "users" DROP COLUMN IF EXISTS "kyc_edd_triggered_at";
    `);
  }
}
