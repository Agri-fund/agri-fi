import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddPreferredCurrencyToUsers1840000000000 implements MigrationInterface {
  name = 'AddPreferredCurrencyToUsers1840000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'preferred_currency',
        type: 'varchar',
        length: '3',
        default: "'USD'",
        isNullable: false,
      }),
    );

    // Create index for fast lookups by currency (useful for reporting/analytics)
    await queryRunner.query(
      `CREATE INDEX "idx_users_preferred_currency" ON "users" ("preferred_currency")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop index
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_users_preferred_currency"`,
    );

    // Drop column
    await queryRunner.dropColumn('users', 'preferred_currency');
  }
}
