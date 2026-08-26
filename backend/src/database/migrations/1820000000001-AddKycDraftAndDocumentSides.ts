import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKycDraftAndDocumentSides1820000000001
  implements MigrationInterface
{
  name = 'AddKycDraftAndDocumentSides1820000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kyc_submissions"
        ADD COLUMN IF NOT EXISTS "identity_document_back_url" TEXT,
        ADD COLUMN IF NOT EXISTS "selfie_url" TEXT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kyc_submissions"
        DROP COLUMN IF EXISTS "identity_document_back_url",
        DROP COLUMN IF EXISTS "selfie_url"
    `);
  }
}
