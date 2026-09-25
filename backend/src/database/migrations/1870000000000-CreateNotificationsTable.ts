import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationsTable1870000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "type" varchar(32) NOT NULL DEFAULT 'alert',
        "title" text NOT NULL,
        "message" text NOT NULL,
        "link_url" text,
        "metadata_json" jsonb,
        "notification_read_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notifications_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_notifications_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      );
      CREATE INDEX "IDX_notifications_user_id" ON "notifications" ("user_id");
      CREATE INDEX "IDX_notifications_read_at" ON "notifications" ("notification_read_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notifications"`);
  }
}
