import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLoginLogs1765000000000 implements MigrationInterface {
  name = 'CreateLoginLogs1765000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "login_logs" (
        "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "ip_address"  TEXT NOT NULL,
        "user_agent"  TEXT NOT NULL,
        "country"     TEXT,
        "city"        TEXT,
        "created_at"  TIMESTAMPTZ DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_login_logs_user_id" ON "login_logs" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "login_logs"`);
  }
}
