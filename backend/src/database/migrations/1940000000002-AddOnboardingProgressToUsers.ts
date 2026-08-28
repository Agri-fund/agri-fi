import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOnboardingProgressToUsers1940000000002
  implements MigrationInterface
{
  name = 'AddOnboardingProgressToUsers1940000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "onboarding_progress" jsonb NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "onboarding_progress"
    `);
  }
}
