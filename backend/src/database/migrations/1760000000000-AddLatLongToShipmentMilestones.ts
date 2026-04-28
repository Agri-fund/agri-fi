import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLatLongToShipmentMilestones1760000000000 implements MigrationInterface {
  name = 'AddLatLongToShipmentMilestones1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shipment_milestones"
      ADD COLUMN "latitude" double precision,
      ADD COLUMN "longitude" double precision
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shipment_milestones"
      DROP COLUMN "longitude",
      DROP COLUMN "latitude"
    `);
  }
}
