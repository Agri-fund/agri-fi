import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class AddApiKeysTable1715000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('api_keys');
    if (!hasTable) {
      await queryRunner.createTable(
        new Table({
          name: 'api_keys',
          columns: [
            {
              name: 'id',
              type: 'uuid',
              isPrimary: true,
              generationStrategy: 'uuid',
              default: 'uuid_generate_v4()',
            },
            {
              name: 'hashed_key',
              type: 'varchar',
              length: '64',
              isUnique: true,
            },
            {
              name: 'prefix',
              type: 'varchar',
              length: '16',
            },
            {
              name: 'label',
              type: 'varchar',
              length: '100',
            },
            {
              name: 'owner_id',
              type: 'uuid',
            },
            {
              name: 'scopes',
              type: 'text',
            },
            {
              name: 'last_used_at',
              type: 'timestamp with time zone',
              isNullable: true,
            },
            {
              name: 'expires_at',
              type: 'timestamp with time zone',
              isNullable: true,
            },
            {
              name: 'revoked_at',
              type: 'timestamp with time zone',
              isNullable: true,
            },
            {
              name: 'created_at',
              type: 'timestamp with time zone',
              default: 'CURRENT_TIMESTAMP',
            },
          ],
        }),
        true,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('api_keys', true);
  }
}
