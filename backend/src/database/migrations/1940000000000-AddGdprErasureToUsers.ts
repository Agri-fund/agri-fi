import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGdprErasureToUsers1940000000000 implements MigrationInterface {
  name = 'AddGdprErasureToUsers1940000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "gdpr_erasure_requested_at" TIMESTAMPTZ`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "gdpr_erasure_due_at" TIMESTAMPTZ`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "gdpr_status" VARCHAR(50) NOT NULL DEFAULT 'active'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "gdpr_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "gdpr_erasure_due_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "gdpr_erasure_requested_at"`,
    );
  }
}
