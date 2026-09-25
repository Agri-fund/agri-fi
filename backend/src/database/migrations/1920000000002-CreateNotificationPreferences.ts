import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationPreferences1920000000002 implements MigrationInterface {
  name = 'CreateNotificationPreferences1920000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "notification_preferences" (
        "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "notification_type" VARCHAR(50) NOT NULL,
        "email_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
        "push_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
        "in_app_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE ("user_id", "notification_type")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_notification_preferences_user_id"
      ON "notification_preferences" ("user_id")
    `);

    // Seed default preferences for existing users
    await queryRunner.query(`
      INSERT INTO notification_preferences (user_id, notification_type, email_enabled, push_enabled, in_app_enabled)
      SELECT u.id, nt.type, TRUE, TRUE, TRUE
      FROM users u
      CROSS JOIN (
        VALUES
          ('deal_update'),
          ('investment_update'),
          ('security_alert'),
          ('kyc_update'),
          ('payment_distributed')
      ) AS nt(type)
      ON CONFLICT (user_id, notification_type) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notification_preferences"`);
  }
}
