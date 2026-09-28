/**
 * batch-seed.ts — Batch database seeding script (#738)
 *
 * Uses TypeORM's bulk `insert()` instead of iterative `save()` calls so that
 * the full seed completes in well under 10 seconds and keeps memory usage low.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register backend/scripts/batch-seed.ts
 * or add to package.json:
 *   "seed:batch": "ts-node -r tsconfig-paths/register scripts/batch-seed.ts"
 */

import 'dotenv-vault/config';
import { AppDataSource } from '../src/database/data-source';
import { User, UserRole } from '../src/auth/entities/user.entity';
import { TradeDeal } from '../src/trade-deals/entities/trade-deal.entity';
import { ShipmentMilestone } from '../src/shipments/entities/shipment-milestone.entity';
import { Investment } from '../src/investments/entities/investment.entity';
import { KycSubmission } from '../src/auth/entities/kyc-submission.entity';
import * as bcrypt from 'bcrypt';

// ─── Tuneable constants ────────────────────────────────────────────────────────
const NUM_USERS = 20;
const NUM_DEALS = 50;
const MILESTONES_PER_DEAL = 2;
const INVESTMENTS_PER_INVESTOR = 5;
const BCRYPT_ROUNDS = 10;
// ──────────────────────────────────────────────────────────────────────────────

const ROLES: UserRole[] = ['farmer', 'trader', 'investor'];
const COUNTRIES = ['KE', 'NG', 'GH', 'TZ', 'UG', 'ET', 'RW', 'SN', 'CM', 'CI'];
const COMMODITIES = [
  'Cocoa', 'Coffee', 'Maize', 'Rice', 'Soybeans',
  'Wheat', 'Cassava', 'Tea', 'Sesame', 'Cashew',
  'Sorghum', 'Millet', 'Groundnuts', 'Sunflower', 'Cotton',
];
const MILESTONE_TYPES: ShipmentMilestone['milestone'][] = [
  'farm', 'warehouse', 'port', 'importer',
];

async function seed(): Promise<void> {
  const startTime = Date.now();
  console.log('🌱 Starting batch database seed…');

  await AppDataSource.initialize();
  console.log('✅ Database connection established');

  const userRepo = AppDataSource.getRepository(User);
  const tradeDealRepo = AppDataSource.getRepository(TradeDeal);
  const milestoneRepo = AppDataSource.getRepository(ShipmentMilestone);
  const investmentRepo = AppDataSource.getRepository(Investment);
  const kycRepo = AppDataSource.getRepository(KycSubmission);

  // ── 1. Truncate in FK-safe order ──────────────────────────────────────────
  console.log('🗑  Clearing existing data…');
  await investmentRepo.delete({});
  await milestoneRepo.delete({});
  await tradeDealRepo.delete({});
  await kycRepo.delete({});
  await userRepo.delete({});
  console.log('   Done.');

  // ── 2. Batch-insert users ──────────────────────────────────────────────────
  console.log(`👤 Seeding ${NUM_USERS} users…`);
  const passwordHash = await bcrypt.hash('password123', BCRYPT_ROUNDS);

  const userRows = Array.from({ length: NUM_USERS }, (_, i) => ({
    email: `user${i + 1}@agri-fi.com`,
    passwordHash,
    role: ROLES[i % ROLES.length],
    country: COUNTRIES[i % COUNTRIES.length],
    kycStatus: 'verified' as const,
    walletAddress: `G${String(i + 1).padStart(55, 'D')}`,
    isCompany: false,
    companyDetails: null,
  }));

  const insertedUsers = await userRepo
    .createQueryBuilder()
    .insert()
    .into(User)
    .values(userRows)
    .returning('*')
    .execute();

  // TypeORM `returning` gives us the generated IDs
  const savedUsers: User[] = insertedUsers.generatedMaps as User[];
  console.log(`   Inserted ${savedUsers.length} users.`);

  // ── 3. Batch-insert KYC submissions ───────────────────────────────────────
  console.log('📋 Seeding KYC submissions…');
  const kycRows = savedUsers.map((u) => ({
    userId: u.id,
    governmentIdUrl: `https://ipfs.io/ipfs/QmHash${(u.id as string).slice(0, 8)}`,
    proofOfAddressUrl: `https://ipfs.io/ipfs/QmAddr${(u.id as string).slice(0, 8)}`,
    isCorporate: false,
    companyName: null,
    registrationNumber: null,
    businessLicenseUrl: null,
    articlesOfIncorporationUrl: null,
    status: 'approved' as const,
  }));

  await kycRepo
    .createQueryBuilder()
    .insert()
    .into(KycSubmission)
    .values(kycRows)
    .execute();
  console.log(`   Inserted ${kycRows.length} KYC submissions.`);

  // ── 4. Batch-insert trade deals ───────────────────────────────────────────
  const farmers = savedUsers.filter((u) => u.role === 'farmer');
  const traders = savedUsers.filter((u) => u.role === 'trader');

  if (farmers.length === 0 || traders.length === 0) {
    throw new Error('Not enough farmers/traders generated — increase NUM_USERS.');
  }

  console.log(`📦 Seeding ${NUM_DEALS} trade deals…`);
  const dealRows = Array.from({ length: NUM_DEALS }, (_, i) => {
    const commodity = COMMODITIES[i % COMMODITIES.length];
    const totalValue = Math.floor(Math.random() * 90_000) + 10_000;
    return {
      commodity,
      quantity: Math.floor(Math.random() * 9_000) + 1_000,
      quantityUnit: 'kg',
      totalValue,
      tokenCount: Math.floor(totalValue / 100),
      tokenSymbol: `${commodity.slice(0, 3).toUpperCase()}${String(i + 1).padStart(3, '0')}`,
      status: 'open' as const,
      farmerId: farmers[i % farmers.length].id,
      traderId: traders[i % traders.length].id,
      escrowPublicKey: null,
      escrowSecretKey: null,
      issuerPublicKey: null,
      issuerSecretKey: null,
      totalInvested: 0,
      deliveryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      stellarAssetTxId: null,
      sorobanCampaignContractId: null,
      sorobanFactoryTxHash: null,
      appTraceId: null,
    };
  });

  const insertedDeals = await tradeDealRepo
    .createQueryBuilder()
    .insert()
    .into(TradeDeal)
    .values(dealRows)
    .returning('*')
    .execute();

  const savedDeals: TradeDeal[] = insertedDeals.generatedMaps as TradeDeal[];
  console.log(`   Inserted ${savedDeals.length} trade deals.`);

  // ── 5. Batch-insert milestones ─────────────────────────────────────────────
  const traderId = traders[0].id;
  console.log(`🚚 Seeding milestones (${MILESTONES_PER_DEAL} per deal)…`);

  const milestoneRows = savedDeals.flatMap((deal, di) =>
    Array.from({ length: MILESTONES_PER_DEAL }, (_, mi) => ({
      tradeDealId: deal.id,
      milestone: MILESTONE_TYPES[mi],
      recordedBy: traderId,
      notes: `Milestone ${mi + 1} for deal ${di + 1}`,
      stellarTxId: null,
      memoText: null,
      latitude: -1.2921 + Math.random() * 5,
      longitude: 36.8219 + Math.random() * 5,
    })),
  );

  // Insert milestones in chunks to keep the INSERT statement manageable
  const CHUNK_SIZE = 100;
  for (let i = 0; i < milestoneRows.length; i += CHUNK_SIZE) {
    const chunk = milestoneRows.slice(i, i + CHUNK_SIZE);
    await milestoneRepo
      .createQueryBuilder()
      .insert()
      .into(ShipmentMilestone)
      .values(chunk)
      .execute();
  }
  console.log(`   Inserted ${milestoneRows.length} milestones.`);

  // ── 6. Batch-insert investments ────────────────────────────────────────────
  const investors = savedUsers.filter((u) => u.role === 'investor');
  if (investors.length > 0) {
    console.log(`💰 Seeding investments…`);
    const investmentRows = investors.flatMap((investor, ii) =>
      savedDeals.slice(0, INVESTMENTS_PER_INVESTOR).map((deal, di) => {
        const tokenAmount = Math.floor(Number(deal.tokenCount) * 0.1);
        const amountUsd = (Number(deal.totalValue) * tokenAmount) / Number(deal.tokenCount);
        return {
          tradeDealId: deal.id,
          investorId: investor.id,
          tokenAmount,
          amountUsd,
          stellarTxId: null,
          complianceData: {
            taxId: `${100 + ii}-45-${6000 + di}`,
            sourceOfFunds: 'business',
          },
          status: 'pending' as const,
        };
      }),
    );

    for (let i = 0; i < investmentRows.length; i += CHUNK_SIZE) {
      const chunk = investmentRows.slice(i, i + CHUNK_SIZE);
      await investmentRepo
        .createQueryBuilder()
        .insert()
        .into(Investment)
        .values(chunk)
        .execute();
    }
    console.log(`   Inserted ${investmentRows.length} investments.`);
  }

  // ── Done ───────────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n✅ Batch seed completed in ${elapsed}s`);
  console.log(
    `   Users: ${savedUsers.length} | Deals: ${savedDeals.length} | Milestones: ${milestoneRows.length}`,
  );

  await AppDataSource.destroy();
}

seed().catch((err) => {
  console.error('❌ Batch seed failed:', err);
  process.exit(1);
});
