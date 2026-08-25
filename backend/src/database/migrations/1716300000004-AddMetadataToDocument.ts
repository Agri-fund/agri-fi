import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMetadataToDocument1716300000004 implements MigrationInterface {
  name = 'AddMetadataToDocument1716300000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "documents"
        ADD COLUMN IF NOT EXISTS "metadata" JSONB DEFAULT '{}'::jsonb
    `);

    // Add a comment to document the metadata structure
    await queryRunner.query(`
      COMMENT ON COLUMN "documents"."metadata" IS 'Document metadata including dimensions, page count, and detected OCR languages'
    `);

    // Optionally create a GIN index for JSONB queries if needed for performance
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_documents_metadata" 
      ON "documents" USING GIN ("metadata")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_documents_metadata"
    `);

    await queryRunner.query(`
      ALTER TABLE "documents" DROP COLUMN IF EXISTS "metadata"
    `);
  }
}
