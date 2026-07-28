import { MigrationInterface, QueryRunner } from 'typeorm';

export class UniqueUserEmail1716300000005 implements MigrationInterface {
  name = 'UniqueUserEmail1716300000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD CONSTRAINT "uq_user_email" UNIQUE ("email")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" DROP CONSTRAINT "uq_user_email"`,
    );
  }
}
