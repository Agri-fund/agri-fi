import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddShipmentSensorReadings1764500000000 implements MigrationInterface {
  name = 'AddShipmentSensorReadings1764500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'shipment_sensor_readings',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'shipment_id', type: 'uuid', isNullable: false },
          { name: 'milestone_id', type: 'uuid', isNullable: true },
          {
            name: 'sensor_type',
            type: 'varchar',
            length: '20',
            isNullable: false,
          },
          { name: 'value', type: 'double precision', isNullable: false },
          { name: 'unit', type: 'varchar', length: '20', isNullable: false },
          {
            name: 'device_id',
            type: 'varchar',
            length: '128',
            isNullable: false,
          },
          { name: 'recorded_at', type: 'timestamptz', isNullable: false },
          { name: 'out_of_range', type: 'boolean', default: false },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'shipment_sensor_readings',
      new TableIndex({
        name: 'IDX_sensor_readings_shipment_recorded',
        columnNames: ['shipment_id', 'recorded_at'],
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('shipment_sensor_readings', true);
  }
}
