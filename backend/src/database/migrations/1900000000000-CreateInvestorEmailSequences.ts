import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the investor_email_sequences table that tracks the onboarding
 * email drip campaign for new investor accounts.
 */
export class CreateInvestorEmailSequences1900000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "investor_email_sequences" (
        "id"             uuid        NOT NULL DEFAULT gen_random_uuid(),
        "user_id"        uuid        NOT NULL,
        "sequence_step"  smallint    NOT NULL,
        "scheduled_at"   TIMESTAMPTZ NOT NULL,
        "sent_at"        TIMESTAMPTZ,
        "error"          text,
        "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),

        CONSTRAINT "PK_investor_email_sequences" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ies_user_id"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_ies_user_step"
          UNIQUE ("user_id", "sequence_step")
      );

      CREATE INDEX "IDX_ies_pending"
        ON "investor_email_sequences" ("sent_at", "scheduled_at")
        WHERE "sent_at" IS NULL;

      CREATE INDEX "IDX_ies_user_scheduled"
        ON "investor_email_sequences" ("user_id", "scheduled_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "investor_email_sequences"`);
  }
}
