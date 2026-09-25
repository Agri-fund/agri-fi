import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVerificationStatusToDocuments1800000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "verification_status" varchar(20) NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "rejection_reason" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "reviewed_by" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "documents" DROP COLUMN IF EXISTS "reviewed_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" DROP COLUMN IF EXISTS "reviewed_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" DROP COLUMN IF EXISTS "rejection_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" DROP COLUMN IF EXISTS "verification_status"`,
    );
  }
}
