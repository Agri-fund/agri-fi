import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: #996 – Adds evidence_document_ids (jsonb) column to shipment_milestones.
 * Stores an array of document UUIDs representing POE-anchored evidence photos
 * captured by the trader when recording a shipment milestone.
 */
export class AddEvidenceToShipmentMilestones1980000000001
  implements MigrationInterface
{
  name = 'AddEvidenceToShipmentMilestones1980000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shipment_milestones"
        ADD COLUMN IF NOT EXISTS "evidence_document_ids" jsonb DEFAULT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_shipment_milestones_evidence"
        ON "shipment_milestones" USING GIN ("evidence_document_ids")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_shipment_milestones_evidence"
    `);
    await queryRunner.query(`
      ALTER TABLE "shipment_milestones"
        DROP COLUMN IF EXISTS "evidence_document_ids"
    `);
  }
}
