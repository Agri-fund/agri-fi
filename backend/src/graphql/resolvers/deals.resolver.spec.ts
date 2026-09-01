/**
 * Unit tests for DealsResolver.
 *
 * TypeORM repositories are fully mocked so no database is required.
 * DataLoader context is provided as a mock context object.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DealsResolver } from './deals.resolver';
import { TradeDeal } from '../../trade-deals/entities/trade-deal.entity';
import { Investment } from '../../investments/entities/investment.entity';
import { ShipmentMilestone } from '../../shipments/entities/shipment-milestone.entity';
import { GqlContext } from '../graphql.module';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockDeal = {
  id: 'deal-uuid-1',
  commodity: 'Cocoa',
  title: 'Cocoa Deal 2026',
  description: null,
  quantity: '10000',
  quantityUnit: 'kg',
  totalValue: '50000',
  expectedRoi: '18.5',
  durationDays: 180,
  tokenCount: 500,
  tokenSymbol: 'COCOA001',
  status: 'open',
  farmerId: 'farmer-uuid',
  traderId: 'trader-uuid',
  escrowPublicKey: null,
  issuerPublicKey: null,
  totalInvested: '0',
  deliveryDate: new Date('2026-12-01'),
  riskRating: 'Low',
  farmLocation: 'Kumasi, Ghana',
  farmLatitude: '6.6885',
  farmLongitude: '-1.6244',
  stellarAssetTxId: null,
  sorobanCampaignContractId: null,
  riskScore: '25.00',
  minLotSize: '100',
  lotStep: '50',
  settlementStatus: 'pending',
  settlementTxHash: null,
  settledAt: null,
  createdAt: new Date('2026-01-01'),
  deletedAt: null,
} as unknown as TradeDeal;

const mockInvestment = {
  id: 'inv-uuid-1',
  tradeDealId: 'deal-uuid-1',
  investorId: 'investor-uuid',
  tokenAmount: 5,
  amountUsd: '500',
  stellarTxId: null,
  status: 'pending',
  createdAt: new Date('2026-01-15'),
  deletedAt: null,
} as unknown as Investment;

const mockMilestone = {
  id: 'ms-uuid-1',
  tradeDealId: 'deal-uuid-1',
  milestone: 'farm',
  recordedBy: 'trader-uuid',
  notes: 'Harvested',
  stellarTxId: null,
  memoText: null,
  latitude: 6.6885,
  longitude: -1.6244,
  recordedAt: new Date('2026-02-01'),
} as unknown as ShipmentMilestone;

// ─── Repository mocks ─────────────────────────────────────────────────────────

const dealRepoMock = {
  find: jest.fn(),
  findOne: jest.fn(),
};
const investmentRepoMock = { find: jest.fn() };
const milestoneRepoMock = { find: jest.fn() };

// ─── Mock DataLoader context ──────────────────────────────────────────────────

const mockCtx: GqlContext = {
  req: {} as any,
  res: {} as any,
  loaders: {
    user: { load: jest.fn() } as any,
    deal: { load: jest.fn() } as any,
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DealsResolver', () => {
  let resolver: DealsResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DealsResolver,
        { provide: getRepositoryToken(TradeDeal), useValue: dealRepoMock },
        { provide: getRepositoryToken(Investment), useValue: investmentRepoMock },
        { provide: getRepositoryToken(ShipmentMilestone), useValue: milestoneRepoMock },
      ],
    }).compile();

    resolver = module.get<DealsResolver>(DealsResolver);
    jest.clearAllMocks();
  });

  describe('deals()', () => {
    it('should return a list of mapped deals', async () => {
      dealRepoMock.find.mockResolvedValue([mockDeal]);

      const result = await resolver.deals();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('deal-uuid-1');
      expect(result[0].commodity).toBe('Cocoa');
      expect(result[0].totalValue).toBe(50000);
      expect(result[0].expectedRoi).toBe(18.5);
      expect(dealRepoMock.find).toHaveBeenCalledWith({ order: { createdAt: 'DESC' } });
    });

    it('should return empty array when no deals exist', async () => {
      dealRepoMock.find.mockResolvedValue([]);
      const result = await resolver.deals();
      expect(result).toEqual([]);
    });
  });

  describe('deal(id)', () => {
    it('should return a mapped deal for a valid id', async () => {
      dealRepoMock.findOne.mockResolvedValue(mockDeal);

      const result = await resolver.deal('deal-uuid-1');

      expect(result.id).toBe('deal-uuid-1');
      expect(result.status).toBe('open');
    });

    it('should throw NotFoundException when deal does not exist', async () => {
      dealRepoMock.findOne.mockResolvedValue(null);

      await expect(resolver.deal('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('resolveFarmer()', () => {
    it('should delegate to the user DataLoader', async () => {
      const gqlDeal = { farmerId: 'farmer-uuid' } as any;
      (mockCtx.loaders.user.load as jest.Mock).mockResolvedValue({
        id: 'farmer-uuid',
        email: 'farmer@test.com',
      });

      const result = await resolver.resolveFarmer(gqlDeal, mockCtx);

      expect(mockCtx.loaders.user.load).toHaveBeenCalledWith('farmer-uuid');
      expect(result?.email).toBe('farmer@test.com');
    });
  });

  describe('resolveInvestments()', () => {
    it('should return investments for the deal', async () => {
      investmentRepoMock.find.mockResolvedValue([mockInvestment]);
      const gqlDeal = { id: 'deal-uuid-1' } as any;

      const result = await resolver.resolveInvestments(gqlDeal);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('inv-uuid-1');
      expect(result[0].amountUsd).toBe(500);
    });
  });

  describe('resolveMilestones()', () => {
    it('should return milestones for the deal in chronological order', async () => {
      milestoneRepoMock.find.mockResolvedValue([mockMilestone]);
      const gqlDeal = { id: 'deal-uuid-1' } as any;

      const result = await resolver.resolveMilestones(gqlDeal);

      expect(result).toHaveLength(1);
      expect(result[0].milestone).toBe('farm');
    });
  });

  describe('deal mapping', () => {
    it('should omit secret keys from mapped deal', async () => {
      const dealWithSecrets = {
        ...mockDeal,
        escrowSecretKey: 'SECRET_KEY',
        issuerSecretKey: 'ISSUER_SECRET',
      } as any;
      dealRepoMock.find.mockResolvedValue([dealWithSecrets]);

      const results = await resolver.deals();

      expect((results[0] as any).escrowSecretKey).toBeUndefined();
      expect((results[0] as any).issuerSecretKey).toBeUndefined();
    });
  });
});
