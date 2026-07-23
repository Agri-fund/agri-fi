import { MigrationInterface, QueryRunner } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

export class AddAppTraceIdAndTriggers1764100000000 implements MigrationInterface {
  name = 'AddAppTraceIdAndTriggers1764100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add app_trace_id column to trade_deals
    await queryRunner.query(`
      ALTER TABLE "trade_deals"
      ADD COLUMN "app_trace_id" TEXT NULL
    `);

    // Execute triggers.sql
    const sqlPath = path.join(__dirname, '..', 'triggers.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await queryRunner.query(sql);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop trigger
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS unauthorized_trade_deal_update_trigger ON trade_deals
    `);

    // Drop trigger function
    await queryRunner.query(`
      DROP FUNCTION IF EXISTS check_unauthorized_trade_deal_update()
    `);

    // Drop send_alert_webhook function
    await queryRunner.query(`
      DROP FUNCTION IF EXISTS send_alert_webhook(TEXT, JSON)
    `);

    // Drop app_trace_id column
    await queryRunner.query(`
      ALTER TABLE "trade_deals"
      DROP COLUMN "app_trace_id"
    `);
  }
}
