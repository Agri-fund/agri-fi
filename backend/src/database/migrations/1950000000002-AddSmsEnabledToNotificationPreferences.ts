import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddSmsEnabledToNotificationPreferences1950000000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'notification_preferences',
      new TableColumn({
        name: 'sms_enabled',
        type: 'boolean',
        default: true,
        isNullable: false,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('notification_preferences', 'sms_enabled');
  }
}
