import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: Add soft-delete support to trade_deals table.
 *
 * Adds a nullable TIMESTAMPTZ column `deleted_at` which is managed by
 * TypeORM's @DeleteDateColumn. When set, TypeORM automatically excludes
 * the row from all standard queries, preserving full audit history.
 *
 * Also adds an index on the `status` column to speed up the
 * marketplace listing query (findOpen) which filters by status = 'open'.
 */
export class AddTradeDealSoftDelete1800000000000 implements MigrationInterface {
  name = 'AddTradeDealSoftDelete1800000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add soft-delete column
    await queryRunner.query(
      `ALTER TABLE "trade_deals" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ`,
    );

    // Add index on status for optimized marketplace listing queries
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_trade_deals_status" ON "trade_deals" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_trade_deals_status"`,
    );

    await queryRunner.query(
      `ALTER TABLE "trade_deals" DROP COLUMN IF EXISTS "deleted_at"`,
    );
  }
}
