import 'dotenv-vault/config';
import { AppDataSource } from '../src/database/data-source';
import { User, UserRole } from '../src/auth/entities/user.entity';
import { TradeDeal } from '../src/trade-deals/entities/trade-deal.entity';
import { ShipmentMilestone } from '../src/shipments/entities/shipment-milestone.entity';
import { Investment } from '../src/investments/entities/investment.entity';
import { KycSubmission } from '../src/auth/entities/kyc-submission.entity';
import * as bcrypt from 'bcrypt';

async function seed() {
  console.log('Starting database seed...');

  await AppDataSource.initialize();
  console.log('Database connection established');

  const userRepository = AppDataSource.getRepository(User);
  const tradeDealRepository = AppDataSource.getRepository(TradeDeal);
  const milestoneRepository = AppDataSource.getRepository(ShipmentMilestone);
  const investmentRepository = AppDataSource.getRepository(Investment);
  const kycSubmissionRepository = AppDataSource.getRepository(KycSubmission);

  // Clear existing data
  await investmentRepository.delete({});
  await milestoneRepository.delete({});
  await tradeDealRepository.delete({});
  await kycSubmissionRepository.delete({});
  await userRepository.delete({});
  console.log('Cleared existing data');

  // Generate 5 mock users
  const mockUsers: User[] = [];
  const roles: UserRole[] = ['farmer', 'trader', 'investor', 'farmer', 'investor'];
  const countries = ['KE', 'NG', 'GH', 'TZ', 'UG'];

  for (let i = 0; i < 5; i++) {
    const user = userRepository.create({
      email: `user${i + 1}@agri-fi.com`,
      passwordHash: await bcrypt.hash('password123', 10),
      role: roles[i],
      country: countries[i],
      kycStatus: 'verified',
      walletAddress: `GD${'A'.repeat(55)}`,
      isCompany: false,
      companyDetails: null,
    });
    mockUsers.push(user);
  }

  await userRepository.save(mockUsers);
  console.log('Created 5 mock users');

  // Create KYC submissions for users
  for (const user of mockUsers) {
    const kycSubmission = kycSubmissionRepository.create({
      userId: user.id,
      governmentIdUrl: `https://ipfs.io/ipfs/QmHash${user.id.slice(0, 8)}`,
      proofOfAddressUrl: `https://ipfs.io/ipfs/QmAddress${user.id.slice(0, 8)}`,
      isCorporate: false,
      companyName: null,
      registrationNumber: null,
      businessLicenseUrl: null,
      articlesOfIncorporationUrl: null,
      status: 'approved',
    });
    await kycSubmissionRepository.save(kycSubmission);
  }
  console.log('Created KYC submissions for users');

  // Generate 10 open trade deals
  const mockTradeDeals: TradeDeal[] = [];
  const commodities = ['Cocoa', 'Coffee', 'Maize', 'Rice', 'Soybeans', 'Wheat', 'Cassava', 'Tea', 'Sesame', 'Cashew'];

  for (let i = 0; i < 10; i++) {
    const farmer = mockUsers[0]; // First user as farmer
    const trader = mockUsers[1]; // Second user as trader
    const tokenCount = Math.floor(Math.random() * 5000) + 1000;
    const totalValue = Math.floor(Math.random() * 100000) + 10000;

    const tradeDeal = tradeDealRepository.create({
      commodity: commodities[i],
      quantity: Math.floor(Math.random() * 10000) + 1000,
      quantityUnit: 'kg',
      totalValue,
      tokenCount,
      tokenSymbol: `${commodities[i].toUpperCase()}-${String(i + 1).padStart(3, '0')}`,
      status: 'open',
      farmerId: farmer.id,
      traderId: trader.id,
      escrowPublicKey: null,
      escrowSecretKey: null,
      issuerPublicKey: null,
      issuerSecretKey: null,
      totalInvested: 0,
      deliveryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      stellarAssetTxId: null,
      sorobanCampaignContractId: null,
      sorobanFactoryTxHash: null,
    });
    mockTradeDeals.push(tradeDeal);
  }

  await tradeDealRepository.save(mockTradeDeals);
  console.log('Created 10 open trade deals');

  // Generate sample milestones for each trade deal
  const milestoneTypes: ShipmentMilestone['milestone'][] = ['farm', 'warehouse', 'port', 'importer'];
  for (const deal of mockTradeDeals) {
    for (let i = 0; i < 2; i++) {
      const milestone = milestoneRepository.create({
        tradeDealId: deal.id,
        milestone: milestoneTypes[i],
        recordedBy: mockUsers[1].id, // Trader records milestones
        notes: `Milestone ${i + 1} for ${deal.commodity}`,
        stellarTxId: null,
        memoText: null,
        latitude: -1.2921 + Math.random() * 0.1,
        longitude: 36.8219 + Math.random() * 0.1,
      });
      await milestoneRepository.save(milestone);
    }
  }
  console.log('Created sample milestones for trade deals');

  // Generate sample investments for some deals
  const investors = mockUsers.filter((u) => u.role === 'investor');
  for (let i = 0; i < 5; i++) {
    const deal = mockTradeDeals[i];
    const investor = investors[i % investors.length];
    const tokenAmount = Math.floor(deal.tokenCount * 0.2);
    const amountUsd = (deal.totalValue * tokenAmount) / deal.tokenCount;

    const investment = investmentRepository.create({
      tradeDealId: deal.id,
      investorId: investor.id,
      tokenAmount,
      amountUsd,
      stellarTxId: null,
      complianceData: { taxId: `123-45-${6789 + i}`, sourceOfFunds: 'business' },
      status: 'pending',
    });
    await investmentRepository.save(investment);
  }
  console.log('Created sample investments');

  console.log('Database seed completed successfully!');
  await AppDataSource.destroy();
}

seed().catch((error) => {
  console.error('Error during seed:', error);
  process.exit(1);
});
