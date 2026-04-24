import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMemoTextToMilestonesAndDocuments1713910000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shipment_milestones" ADD COLUMN "memo_text" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD COLUMN "memo_text" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "documents" DROP COLUMN "memo_text"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shipment_milestones" DROP COLUMN "memo_text"`,
    );
  }
}
