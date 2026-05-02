import { MigrationInterface, QueryRunner } from 'typeorm';
import * as bcrypt from 'bcrypt';

/**
 * Seeds demo users (farmer, trader, investor) and 6 initial trade deals.
 * All passwords are: Password123!
 */
export class SeedInitialData1762000000000 implements MigrationInterface {
  name = 'SeedInitialData1762000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const passwordHash = await bcrypt.hash('Password123!', 10);

    // ── Users ──────────────────────────────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO users (id, email, password_hash, role, country, kyc_status, wallet_address)
      VALUES
        ('a0000000-0000-0000-0000-000000000001', 'farmer@agri-fi.demo',  '${passwordHash}', 'farmer',   'KE', 'verified', NULL),
        ('a0000000-0000-0000-0000-000000000002', 'trader@agri-fi.demo',  '${passwordHash}', 'trader',   'GH', 'verified', NULL),
        ('a0000000-0000-0000-0000-000000000003', 'investor@agri-fi.demo','${passwordHash}', 'investor', 'NG', 'verified', NULL)
      ON CONFLICT (email) DO NOTHING
    `);

    // ── Trade Deals ────────────────────────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO trade_deals (
        id, commodity, quantity, quantity_unit, total_value,
        token_count, token_symbol, status,
        farmer_id, trader_id,
        total_invested, delivery_date
      ) VALUES
        (
          'b0000000-0000-0000-0000-000000000001',
          'Cocoa Beans', 5000, 'kg', 75000,
          750, 'COCOA001', 'open',
          'a0000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-000000000002',
          0, '2026-09-15'
        ),
        (
          'b0000000-0000-0000-0000-000000000002',
          'Arabica Coffee', 3000, 'kg', 54000,
          540, 'COFFE001', 'open',
          'a0000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-000000000002',
          0, '2026-08-20'
        ),
        (
          'b0000000-0000-0000-0000-000000000003',
          'Cashew Nuts', 8000, 'kg', 96000,
          960, 'CASHE001', 'open',
          'a0000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-000000000002',
          0, '2026-10-01'
        ),
        (
          'b0000000-0000-0000-0000-000000000004',
          'Sesame Seeds', 10000, 'kg', 45000,
          450, 'SESAM001', 'open',
          'a0000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-000000000002',
          0, '2026-07-30'
        ),
        (
          'b0000000-0000-0000-0000-000000000005',
          'Shea Butter', 2000, 'kg', 30000,
          300, 'SHEAB001', 'open',
          'a0000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-000000000002',
          0, '2026-11-10'
        ),
        (
          'b0000000-0000-0000-0000-000000000006',
          'Sorghum', 20000, 'kg', 28000,
          280, 'SORGH001', 'open',
          'a0000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-000000000002',
          0, '2026-12-05'
        )
      ON CONFLICT (id) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM trade_deals
      WHERE id IN (
        'b0000000-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-000000000002',
        'b0000000-0000-0000-0000-000000000003',
        'b0000000-0000-0000-0000-000000000004',
        'b0000000-0000-0000-0000-000000000005',
        'b0000000-0000-0000-0000-000000000006'
      )
    `);
    await queryRunner.query(`
      DELETE FROM users
      WHERE id IN (
        'a0000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-000000000002',
        'a0000000-0000-0000-0000-000000000003'
      )
    `);
  }
}
