import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDealHealthAlertsTable1890000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "deal_health_alerts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "deal_id" uuid NOT NULL,
        "alert_type" varchar(64) NOT NULL,
        "alert_message" text NOT NULL,
        "fired_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "resolved_at" TIMESTAMP WITH TIME ZONE,
        "metadata_json" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_deal_health_alerts_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_deal_health_alerts_deal_id" FOREIGN KEY ("deal_id")
          REFERENCES "trade_deals"("id") ON DELETE CASCADE
      );
      CREATE INDEX "IDX_deal_health_alerts_deal_id" ON "deal_health_alerts" ("deal_id");
      CREATE INDEX "IDX_deal_health_alerts_type_resolved"
        ON "deal_health_alerts" ("deal_id", "alert_type", "resolved_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "deal_health_alerts"`);
  }
}
