import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAchievementsTable1880000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "achievements" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "badge_type" varchar(64) NOT NULL,
        "earned_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "granted_by" varchar(64),
        "reason" text,
        "metadata" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_achievements_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_achievements_user_badge" UNIQUE ("user_id", "badge_type"),
        CONSTRAINT "FK_achievements_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      );
      CREATE INDEX "IDX_achievements_user_id" ON "achievements" ("user_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "achievements"`);
  }
}
