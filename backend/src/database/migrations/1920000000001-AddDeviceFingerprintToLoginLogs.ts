import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeviceFingerprintToLoginLogs1920000000001 implements MigrationInterface {
  name = 'AddDeviceFingerprintToLoginLogs1920000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "login_logs"
      ADD COLUMN "device_fingerprint" TEXT,
      ADD COLUMN "country_code" VARCHAR(2)
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_login_logs_device_fingerprint"
      ON "login_logs" ("device_fingerprint")
      WHERE "device_fingerprint" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_login_logs_country_code"
      ON "login_logs" ("country_code")
      WHERE "country_code" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_login_logs_country_code"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_login_logs_device_fingerprint"`);
    await queryRunner.query(`
      ALTER TABLE "login_logs"
      DROP COLUMN IF EXISTS "country_code",
      DROP COLUMN IF EXISTS "device_fingerprint"
    `);
  }
}
