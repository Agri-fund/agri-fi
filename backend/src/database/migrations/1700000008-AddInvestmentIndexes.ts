import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvestmentIndexes1700000008 implements MigrationInterface {
  name = 'AddInvestmentIndexes1700000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Composite index on (trade_deal_id, status) for investment availability queries
    // This optimizes the critical query in InvestmentsService.createInvestment()
    await queryRunner.query(`
      CREATE INDEX "idx_investments_trade_deal_status" ON "investments" ("trade_deal_id", "status")
    `);

    // Index on investor_id for GET /users/me/investments queries
    await queryRunner.query(`
      CREATE INDEX "idx_investments_investor_id" ON "investments" ("investor_id")
    `);

    // Index on trade_deal_id in shipment_milestones for milestone sequence queries
    await queryRunner.query(`
      CREATE INDEX "idx_shipment_milestones_trade_deal_id" ON "shipment_milestones" ("trade_deal_id")
    `);

    // Index on trade_deal_id in payment_distributions for escrow audit queries
    // Note: This table already has this index from the original migration, but we ensure it exists
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_payment_distributions_trade_deal_id" ON "payment_distributions" ("trade_deal_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes in reverse order
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_payment_distributions_trade_deal_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_shipment_milestones_trade_deal_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_investments_investor_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_investments_trade_deal_status"`);
  }
}