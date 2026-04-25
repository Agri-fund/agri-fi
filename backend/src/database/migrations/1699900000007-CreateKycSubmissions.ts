import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKycSubmissions1699900000007 implements MigrationInterface {
  name = 'CreateKycSubmissions1699900000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Update users role check to include 'admin'
    // First, we drop the existing check constraint. Since it was likely automatically named, 
    // we'll try to drop it if it exists or just use a raw alter if possible.
    // In many cases with TypeORM migrations like the one seen, it might be easier to just add the table
    // and assume the 'admin' role addition to the type is enough for the app, 
    // but the DB check will fail.
    
    // Attempting to update the check constraint for 'role'
    await queryRunner.query(`
      ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_check";
      ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK (role IN ('farmer', 'trader', 'investor', 'admin'));
    `);

    await queryRunner.query(`
      CREATE TABLE "kyc_submissions" (
        "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"               UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "government_id_url"     TEXT NOT NULL,
        "proof_of_address_url"  TEXT NOT NULL,
        "status"                TEXT NOT NULL DEFAULT 'pending_review' 
                                  CHECK (status IN ('pending_review', 'approved', 'rejected')),
        "created_at"            TIMESTAMPTZ DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "kyc_submissions"`);
    
    // Revert role check
    await queryRunner.query(`
      ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_check";
      ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK (role IN ('farmer', 'trader', 'investor'));
    `);
  }
}
