import { MigrationInterface, QueryRunner } from 'typeorm';

export class UniqueUserEmail1716300000005 implements MigrationInterface {
  name = 'UniqueUserEmail1716300000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Table is "users" (not "user"). Email already has UNIQUE from CreateUsers;
    // add the named constraint only when it is missing.
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE "users" ADD CONSTRAINT "uq_user_email" UNIQUE ("email");
      EXCEPTION
        WHEN duplicate_object THEN NULL;
        WHEN unique_violation THEN NULL;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "uq_user_email"`,
    );
  }
}
