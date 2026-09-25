import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDocumentExpiresAtToKycSubmissions1800000000000 implements MigrationInterface {
  name = 'AddDocumentExpiresAtToKycSubmissions1800000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kyc_submissions" ADD COLUMN "document_expires_at" TIMESTAMPTZ;
    `);

    await queryRunner.query(`
      ALTER TABLE "kyc_submissions" DROP CONSTRAINT IF EXISTS "kyc_submissions_status_check";
      ALTER TABLE "kyc_submissions" ADD CONSTRAINT "kyc_submissions_status_check" CHECK (status IN ('pending_review', 'approved', 'rejected', 'expired'));
    `);

    await queryRunner.query(`
      ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_kyc_status_check";
      ALTER TABLE "users" ADD CONSTRAINT "users_kyc_status_check" CHECK (kyc_status IN ('pending', 'verified', 'rejected', 'expired'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kyc_submissions" DROP COLUMN "document_expires_at";
    `);

    await queryRunner.query(`
      ALTER TABLE "kyc_submissions" DROP CONSTRAINT IF EXISTS "kyc_submissions_status_check";
      ALTER TABLE "kyc_submissions" ADD CONSTRAINT "kyc_submissions_status_check" CHECK (status IN ('pending_review', 'approved', 'rejected'));
    `);

    await queryRunner.query(`
      ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_kyc_status_check";
      ALTER TABLE "users" ADD CONSTRAINT "users_kyc_status_check" CHECK (kyc_status IN ('pending', 'verified', 'rejected'));
    `);
  }
}
