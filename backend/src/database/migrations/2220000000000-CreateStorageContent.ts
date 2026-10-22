import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStorageContent2220000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "storage_content" (
        "cid" varchar(128) NOT NULL,
        "size_bytes" bigint NOT NULL DEFAULT 0,
        "replica_count" integer NOT NULL DEFAULT 1,
        "retrieval_count" integer NOT NULL DEFAULT 0,
        "average_retrieval_ms" double precision NOT NULL DEFAULT 0,
        "last_verified_at" TIMESTAMP WITH TIME ZONE,
        "last_accessed_at" TIMESTAMP WITH TIME ZONE,
        "retention_until" TIMESTAMP WITH TIME ZONE,
        "legal_hold" boolean NOT NULL DEFAULT false,
        "archived" boolean NOT NULL DEFAULT false,
        "archive_key" varchar(512),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_storage_content_cid" PRIMARY KEY ("cid")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_storage_content_retention" ON "storage_content" ("retention_until") WHERE "legal_hold" = false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_storage_content_accessed" ON "storage_content" ("last_accessed_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "storage_content"`);
  }
}
