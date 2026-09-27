import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSignatureRequestsTable2050000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "signature_requests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "document_id" uuid NOT NULL,
        "co_signer_id" uuid NOT NULL,
        "requester_id" uuid NOT NULL,
        "status" text NOT NULL DEFAULT 'pending',
        "signing_token" text NOT NULL,
        "signing_token_hash" text NOT NULL,
        "signing_token_expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "pfp_hash" text,
        "stellar_tx_id" text,
        "signature_method" text,
        "signed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_signature_requests_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_signature_requests_document" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_signature_requests_co_signer" FOREIGN KEY ("co_signer_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_signature_requests_requester" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE
      );
      CREATE INDEX "IDX_signature_requests_co_signer_id" ON "signature_requests" ("co_signer_id");
      CREATE INDEX "IDX_signature_requests_status" ON "signature_requests" ("status");
      CREATE INDEX "IDX_signature_requests_expires_at" ON "signature_requests" ("signing_token_expires_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "signature_requests"`);
  }
}
