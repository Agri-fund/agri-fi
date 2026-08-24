import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateAccountMergeRecovery1850000000000 implements MigrationInterface {
  name = 'CreateAccountMergeRecovery1850000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'account_merge_recovery',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'original_public_key',
            type: 'varchar',
            length: '56',
            isNullable: false,
          },
          {
            name: 'merged_public_key',
            type: 'varchar',
            length: '56',
            isNullable: false,
          },
          {
            name: 'replacement_public_key',
            type: 'varchar',
            length: '56',
            isNullable: true,
          },
          {
            name: 'replacement_secret_key_encrypted',
            type: 'varchar',
            length: '200',
            isNullable: true,
          },
          {
            name: 'original_investor_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '20',
            default: "'detected'",
            isNullable: false,
          },
          {
            name: 'detected_in_tx_hash',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'payment_retry_attempts',
            type: 'int',
            default: 0,
            isNullable: false,
          },
          {
            name: 'last_error_message',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'recovered_at',
            type: 'timestamptz',
            isNullable: true,
          },
        ],
      }),
    );

    // Create indexes for fast lookups
    await queryRunner.createIndex(
      'account_merge_recovery',
      new TableIndex({
        name: 'idx_merged_account',
        columnNames: ['merged_public_key'],
      }),
    );

    await queryRunner.createIndex(
      'account_merge_recovery',
      new TableIndex({
        name: 'idx_replacement_account',
        columnNames: ['replacement_public_key'],
      }),
    );

    await queryRunner.createIndex(
      'account_merge_recovery',
      new TableIndex({
        name: 'idx_original_investor',
        columnNames: ['original_investor_id'],
      }),
    );

    // Status index for recovery queries
    await queryRunner.createIndex(
      'account_merge_recovery',
      new TableIndex({
        name: 'idx_recovery_status',
        columnNames: ['status'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('account_merge_recovery');
  }
}
