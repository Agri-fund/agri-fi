/**
 * Unit tests for UserDataLoaderService and DealDataLoaderService.
 *
 * Verifies batching behaviour: multiple concurrent load() calls for different
 * IDs should result in a single findOne / find query (the batch function).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserDataLoaderService } from '../dataloaders/user.dataloader';
import { DealDataLoaderService } from '../dataloaders/deal.dataloader';
import { User } from '../../auth/entities/user.entity';
import { TradeDeal } from '../../trade-deals/entities/trade-deal.entity';

// ─── User DataLoader tests ────────────────────────────────────────────────────

const userA: Partial<User> = {
  id: 'user-a',
  email: 'a@test.com',
  role: 'farmer',
  country: 'KE',
  kycStatus: 'verified',
  walletAddress: null,
  isCompany: false,
  isEmailVerified: true,
  isMfaEnabled: false,
  creditScore: null,
  preferredLanguage: 'en',
  timezone: null,
  emailDigestEnabled: true,
  createdAt: new Date('2026-01-01'),
};

const userB: Partial<User> = {
  ...userA,
  id: 'user-b',
  email: 'b@test.com',
  role: 'investor',
};

describe('UserDataLoaderService', () => {
  let service: UserDataLoaderService;
  const userRepoMock = { find: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserDataLoaderService,
        { provide: getRepositoryToken(User), useValue: userRepoMock },
      ],
    }).compile();

    service = module.get<UserDataLoaderService>(UserDataLoaderService);
    jest.clearAllMocks();
  });

  it('should batch multiple load calls into a single repository query', async () => {
    userRepoMock.find.mockResolvedValue([userA, userB]);

    const loader = service.createLoader();
    // Fire both loads concurrently so they are batched together.
    const [resultA, resultB] = await Promise.all([
      loader.load('user-a'),
      loader.load('user-b'),
    ]);

    expect(userRepoMock.find).toHaveBeenCalledTimes(1);
    expect(resultA?.id).toBe('user-a');
    expect(resultB?.id).toBe('user-b');
  });

  it('should return null for IDs not found in the repository', async () => {
    userRepoMock.find.mockResolvedValue([userA]);

    const loader = service.createLoader();
    const [resultA, resultMissing] = await Promise.all([
      loader.load('user-a'),
      loader.load('missing-id'),
    ]);

    expect(resultA?.id).toBe('user-a');
    expect(resultMissing).toBeNull();
  });

  it('should strip sensitive fields from mapped user', async () => {
    const entityWithSecrets = {
      ...userA,
      passwordHash: 'hashed-pw',
      mfaSecret: 'totp-secret',
      taxId: 'encrypted-taxid',
    };
    userRepoMock.find.mockResolvedValue([entityWithSecrets]);

    const loader = service.createLoader();
    const result = await loader.load('user-a');

    expect((result as any)?.passwordHash).toBeUndefined();
    expect((result as any)?.mfaSecret).toBeUndefined();
    expect((result as any)?.taxId).toBeUndefined();
    expect(result?.email).toBe('a@test.com');
  });

  it('should create a fresh loader instance on each call', () => {
    const loader1 = service.createLoader();
    const loader2 = service.createLoader();
    expect(loader1).not.toBe(loader2);
  });
});

// ─── Deal DataLoader tests ────────────────────────────────────────────────────

const dealA: Partial<TradeDeal> = {
  id: 'deal-a',
  commodity: 'Cocoa',
  title: null,
  description: null,
  quantity: '10000' as any,
  quantityUnit: 'kg',
  totalValue: '50000' as any,
  expectedRoi: '18.5' as any,
  durationDays: 180,
  tokenCount: 500,
  tokenSymbol: 'COCOA001',
  status: 'open',
  farmerId: 'farmer-uuid',
  traderId: 'trader-uuid',
  escrowPublicKey: null,
  issuerPublicKey: null,
  totalInvested: '0' as any,
  deliveryDate: new Date('2026-12-01'),
  riskRating: null,
  farmLocation: null,
  farmLatitude: null,
  farmLongitude: null,
  stellarAssetTxId: null,
  sorobanCampaignContractId: null,
  riskScore: null,
  minLotSize: '100' as any,
  lotStep: '50' as any,
  settlementStatus: 'pending',
  settlementTxHash: null,
  settledAt: null,
  createdAt: new Date('2026-01-01'),
  deletedAt: null,
};

const dealB: Partial<TradeDeal> = {
  ...dealA,
  id: 'deal-b',
  tokenSymbol: 'MAIZE001',
};

describe('DealDataLoaderService', () => {
  let service: DealDataLoaderService;
  const dealRepoMock = { find: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DealDataLoaderService,
        { provide: getRepositoryToken(TradeDeal), useValue: dealRepoMock },
      ],
    }).compile();

    service = module.get<DealDataLoaderService>(DealDataLoaderService);
    jest.clearAllMocks();
  });

  it('should batch multiple load calls into a single repository query', async () => {
    dealRepoMock.find.mockResolvedValue([dealA, dealB]);

    const loader = service.createLoader();
    const [resultA, resultB] = await Promise.all([
      loader.load('deal-a'),
      loader.load('deal-b'),
    ]);

    expect(dealRepoMock.find).toHaveBeenCalledTimes(1);
    expect(resultA?.id).toBe('deal-a');
    expect(resultB?.id).toBe('deal-b');
  });

  it('should return null for IDs not found', async () => {
    dealRepoMock.find.mockResolvedValue([dealA]);

    const loader = service.createLoader();
    const [resultA, resultMissing] = await Promise.all([
      loader.load('deal-a'),
      loader.load('missing-id'),
    ]);

    expect(resultA?.id).toBe('deal-a');
    expect(resultMissing).toBeNull();
  });

  it('should omit escrow and issuer secret keys', async () => {
    const dealWithSecrets = {
      ...dealA,
      escrowSecretKey: 'SECRET',
      issuerSecretKey: 'ISSUER_SECRET',
    };
    dealRepoMock.find.mockResolvedValue([dealWithSecrets]);

    const loader = service.createLoader();
    const result = await loader.load('deal-a');

    expect((result as any)?.escrowSecretKey).toBeUndefined();
    expect((result as any)?.issuerSecretKey).toBeUndefined();
  });

  it('should cast decimal string fields to numbers', async () => {
    dealRepoMock.find.mockResolvedValue([dealA]);

    const loader = service.createLoader();
    const result = await loader.load('deal-a');

    expect(typeof result?.totalValue).toBe('number');
    expect(result?.totalValue).toBe(50000);
    expect(typeof result?.minLotSize).toBe('number');
  });
});
