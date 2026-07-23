import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdminActions1790000000000 implements MigrationInterface {
  name = 'CreateAdminActions1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "admin_actions" (
        "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "admin_id"       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        "target_user_id" UUID REFERENCES users(id) ON DELETE SET NULL,
        "action"         VARCHAR(50) NOT NULL,
        "payload"        JSONB,
        "reason"         TEXT,
        "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_admin_actions_admin_id" ON "admin_actions" ("admin_id")`);
    await queryRunner.query(`CREATE INDEX "idx_admin_actions_target_user_id" ON "admin_actions" ("target_user_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_actions"`);
  }
}
