import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPiiEncryptedColumns1765000000000 implements MigrationInterface {
  name = 'AddPiiEncryptedColumns1765000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable pgcrypto extension for potential server-side encryption utilities
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // Add encrypted PII columns — stored as TEXT (AES-256-CBC: iv:ciphertext hex)
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "full_name" TEXT,
        ADD COLUMN IF NOT EXISTS "birthdate" TEXT,
        ADD COLUMN IF NOT EXISTS "tax_id"    TEXT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "full_name",
        DROP COLUMN IF EXISTS "birthdate",
        DROP COLUMN IF EXISTS "tax_id"
    `);
  }
}
