import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';

export class EscrowMigrationsAndDataRetention1750000000000 implements MigrationInterface {
  name = 'EscrowMigrationsAndDataRetention1750000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------------------------------------------------------------------
    // escrow_migrations table
    // ---------------------------------------------------------------------
    await queryRunner.createTable(
      new Table({
        name: 'escrow_migrations',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'trade_deal_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '32',
            isNullable: false,
            default: "'pending'",
          },
          {
            name: 'escrow_account',
            type: 'varchar',
            length: '64',
            isNullable: true,
          },
          {
            name: 'transaction_hash',
            type: 'varchar',
            length: '128',
            isNullable: true,
          },
          {
            name: 'error_message',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'attempts',
            type: 'int',
            isNullable: false,
            default: 0,
          },
          {
            name: 'initiated_by',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'started_at',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'completed_at',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            isNullable: false,
            default: 'now()',
          },
          {
            name: 'updated_at',
            type: 'timestamptz',
            isNullable: false,
            default: 'now()',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'escrow_migrations',
      new TableIndex({
        name: 'IDX_escrow_migrations_trade_deal_id',
        columnNames: ['trade_deal_id'],
      }),
    );

    await queryRunner.createIndex(
      'escrow_migrations',
      new TableIndex({
        name: 'IDX_escrow_migrations_status',
        columnNames: ['status'],
      }),
    );

    // ---------------------------------------------------------------------
    // users.retention_exempt column
    // ---------------------------------------------------------------------
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'retention_exempt',
        type: 'boolean',
        isNullable: false,
        default: false,
      }),
    );

    // ---------------------------------------------------------------------
    // data_retention_log table
    // ---------------------------------------------------------------------
    await queryRunner.createTable(
      new Table({
        name: 'data_retention_log',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'user_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'action',
            type: 'varchar',
            length: '64',
            isNullable: false,
          },
          {
            name: 'anonymised_fields',
            type: 'jsonb',
            isNullable: false,
            default: "'[]'",
          },
          {
            name: 'reason',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'performed_at',
            type: 'timestamptz',
            isNullable: false,
            default: 'now()',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'data_retention_log',
      new TableIndex({
        name: 'IDX_data_retention_log_user_id',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createIndex(
      'data_retention_log',
      new TableIndex({
        name: 'IDX_data_retention_log_performed_at',
        columnNames: ['performed_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'data_retention_log',
      'IDX_data_retention_log_performed_at',
    );
    await queryRunner.dropIndex(
      'data_retention_log',
      'IDX_data_retention_log_user_id',
    );
    await queryRunner.dropTable('data_retention_log', true);

    await queryRunner.dropColumn('users', 'retention_exempt');

    await queryRunner.dropIndex(
      'escrow_migrations',
      'IDX_escrow_migrations_status',
    );
    await queryRunner.dropIndex(
      'escrow_migrations',
      'IDX_escrow_migrations_trade_deal_id',
    );
    await queryRunner.dropTable('escrow_migrations', true);
  }
}