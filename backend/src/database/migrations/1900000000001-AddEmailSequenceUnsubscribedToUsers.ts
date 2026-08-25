import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the email_sequence_unsubscribed column to the users table.
 * This flag is set when an investor clicks the unsubscribe link in any
 * drip-campaign email and gates all further sequence dispatches (GDPR/CAN-SPAM).
 */
export class AddEmailSequenceUnsubscribedToUsers1900000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "email_sequence_unsubscribed"
          boolean NOT NULL DEFAULT false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "email_sequence_unsubscribed";
    `);
  }
}
