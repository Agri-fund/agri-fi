import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDidDocuments2230000000000 implements MigrationInterface {
  name = 'CreateDidDocuments2230000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "did_document" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "did" varchar(512) NOT NULL,
        "document" jsonb NOT NULL,
        "controller" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deactivated_at" timestamptz NULL,
        CONSTRAINT "PK_did_document" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_did_document_did" UNIQUE ("did"),
        CONSTRAINT "FK_did_document_controller" FOREIGN KEY ("controller") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_did_document_did" ON "did_document" ("did")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_did_document_controller" ON "did_document" ("controller")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_did_document_controller"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_did_document_did"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "did_document"`);
  }
}
