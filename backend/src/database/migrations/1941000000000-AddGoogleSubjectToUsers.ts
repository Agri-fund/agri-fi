import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGoogleSubjectToUsers1941000000000 implements MigrationInterface {
  name = 'AddGoogleSubjectToUsers1941000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "google_subject" TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_users_google_subject"
        ON "users" ("google_subject")
        WHERE "google_subject" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_users_google_subject";
      ALTER TABLE "users" DROP COLUMN IF EXISTS "google_subject";
    `);
  }
}