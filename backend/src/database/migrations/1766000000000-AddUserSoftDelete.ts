import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserSoftDelete1766000000000 implements MigrationInterface {
  name = 'AddUserSoftDelete1766000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMPTZ`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "deleted_at"`,
    );
  }
}
