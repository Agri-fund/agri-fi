import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds PostgreSQL full-text search vectors and GIN indexes for unified search (#894).
 */
export class AddFullTextSearch1940000000000 implements MigrationInterface {
  name = 'AddFullTextSearch1940000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    // trade_deals — title/description columns for richer search
    await queryRunner.query(`
      ALTER TABLE "trade_deals"
      ADD COLUMN IF NOT EXISTS "title" VARCHAR(255) NULL,
      ADD COLUMN IF NOT EXISTS "description" TEXT NULL,
      ADD COLUMN IF NOT EXISTS "search_vector" tsvector
    `);

    await queryRunner.query(`
      UPDATE "trade_deals"
      SET
        "title" = COALESCE("title", "commodity"),
        "description" = COALESCE(
          "description",
          "quantity"::text || ' ' || "quantity_unit" || ' of ' || "commodity"
        )
      WHERE "title" IS NULL OR "description" IS NULL
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION trade_deals_search_vector_update() RETURNS trigger AS $$
      BEGIN
        NEW.search_vector :=
          setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
          setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B') ||
          setweight(to_tsvector('english', COALESCE(NEW.commodity, '')), 'A');
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE TRIGGER trade_deals_search_vector_trigger
      BEFORE INSERT OR UPDATE OF title, description, commodity ON "trade_deals"
      FOR EACH ROW EXECUTE FUNCTION trade_deals_search_vector_update()
    `);

    await queryRunner.query(`
      UPDATE "trade_deals" SET "title" = "title"
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_trade_deals_search_vector"
      ON "trade_deals" USING GIN ("search_vector")
    `);

    // users — search on full_name and company name
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "search_vector" tsvector
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION users_search_vector_update() RETURNS trigger AS $$
      BEGIN
        NEW.search_vector :=
          setweight(to_tsvector('english', COALESCE(NEW.full_name, '')), 'A') ||
          setweight(
            to_tsvector('english', COALESCE(NEW.company_details->>'companyName', '')),
            'B'
          );
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE TRIGGER users_search_vector_trigger
      BEFORE INSERT OR UPDATE OF full_name, company_details ON "users"
      FOR EACH ROW EXECUTE FUNCTION users_search_vector_update()
    `);

    await queryRunner.query(`
      UPDATE "users" SET "full_name" = "full_name"
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_users_search_vector"
      ON "users" USING GIN ("search_vector")
    `);

    // documents — title column + metadata for search
    await queryRunner.query(`
      ALTER TABLE "documents"
      ADD COLUMN IF NOT EXISTS "title" VARCHAR(255) NULL,
      ADD COLUMN IF NOT EXISTS "search_vector" tsvector
    `);

    await queryRunner.query(`
      UPDATE "documents"
      SET "title" = COALESCE("title", "doc_type")
      WHERE "title" IS NULL
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION documents_search_vector_update() RETURNS trigger AS $$
      BEGIN
        NEW.search_vector :=
          setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
          setweight(to_tsvector('english', COALESCE(NEW.doc_type, '')), 'B') ||
          setweight(to_tsvector('english', COALESCE(NEW.metadata::text, '')), 'C');
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      CREATE TRIGGER documents_search_vector_trigger
      BEFORE INSERT OR UPDATE OF title, doc_type, metadata ON "documents"
      FOR EACH ROW EXECUTE FUNCTION documents_search_vector_update()
    `);

    await queryRunner.query(`
      UPDATE "documents" SET "title" = "title"
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_documents_search_vector"
      ON "documents" USING GIN ("search_vector")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS documents_search_vector_trigger ON "documents"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS documents_search_vector_update()`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_documents_search_vector"`);
    await queryRunner.query(`
      ALTER TABLE "documents"
      DROP COLUMN IF EXISTS "search_vector",
      DROP COLUMN IF EXISTS "title"
    `);

    await queryRunner.query(`DROP TRIGGER IF EXISTS users_search_vector_trigger ON "users"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS users_search_vector_update()`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_users_search_vector"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "search_vector"`);

    await queryRunner.query(`DROP TRIGGER IF EXISTS trade_deals_search_vector_trigger ON "trade_deals"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS trade_deals_search_vector_update()`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_trade_deals_search_vector"`);
    await queryRunner.query(`
      ALTER TABLE "trade_deals"
      DROP COLUMN IF EXISTS "search_vector",
      DROP COLUMN IF EXISTS "description",
      DROP COLUMN IF EXISTS "title"
    `);
  }
}
