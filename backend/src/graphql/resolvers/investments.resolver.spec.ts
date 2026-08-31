/**
 * Unit tests for InvestmentsResolver.
 *
 * InvestmentsService is mocked to isolate resolver logic.
 * TypeORM repositories are fully mocked; no database is required.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InvestmentsResolver } from './investments.resolver';
import { Investment, InvestmentStatus } from '../../investments/entities/investment.entity';
import { TradeDeal } from '../../trade-deals/entities/trade-deal.entity';
import { InvestmentsService } from '../../investments/investments.service';
import { GQL_PUB_SUB } from '../graphql.pubsub';
import { GqlContext } from '../graphql.module';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockUser = {
  id: 'investor-uuid',
  email: 'investor@test.com',
  role: 'investor',
} as any;

const pendingInvestment = {
  id: 'inv-uuid-1',
  tradeDealId: 'deal-uuid-1',
  investorId: 'investor-uuid',
  tokenAmount: 5,
  amountUsd: '500',
  stellarTxId: null,
  status: InvestmentStatus.PENDING,
  createdAt: new Date('2026-01-15'),
  deletedAt: null,
} as unknown as Investment;

const confirmedInvestment = {
  ...pendingInvestment,
  id: 'inv-uuid-2',
  status: InvestmentStatus.CONFIRMED,
};

const activeInvestment = {
  ...pendingInvestment,
  id: 'inv-uuid-3',
  status: InvestmentStatus.ACTIVE,
};

const mockDeal = {
  id: 'deal-uuid-1',
  totalInvested: '500',
  totalValue: '50000',
  status: 'open',
} as unknown as TradeDeal;

// ─── Mocks ────────────────────────────────────────────────────────────────────

const investmentRepoMock = {
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
};
const dealRepoMock = {
  findOne: jest.fn(),
};
const investmentsServiceMock = {
  createInvestment: jest.fn(),
};
const pubSubMock = {
  publish: jest.fn(),
  asyncIterator: jest.fn(),
};
const mockCtx: GqlContext = {
  req: {} as any,
  res: {} as any,
  loaders: {
    user: { load: jest.fn() } as any,
    deal: { load: jest.fn() } as any,
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('InvestmentsResolver', () => {
  let resolver: InvestmentsResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvestmentsResolver,
        { provide: getRepositoryToken(Investment), useValue: investmentRepoMock },
        { provide: getRepositoryToken(TradeDeal), useValue: dealRepoMock },
        { provide: InvestmentsService, useValue: investmentsServiceMock },
        { provide: GQL_PUB_SUB, useValue: pubSubMock },
      ],
    }).compile();

    resolver = module.get<InvestmentsResolver>(InvestmentsResolver);
    jest.clearAllMocks();
  });

  describe('investments()', () => {
    it('should return investments for the authenticated user', async () => {
      investmentRepoMock.find.mockResolvedValue([pendingInvestment]);

      const result = await resolver.investments(mockUser);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('inv-uuid-1');
      expect(result[0].amountUsd).toBe(500);
      expect(investmentRepoMock.find).toHaveBeenCalledWith({
        where: { investorId: mockUser.id },
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('investment(id)', () => {
    it('should return the investment if it belongs to the user', async () => {
      investmentRepoMock.findOne.mockResolvedValue(pendingInvestment);

      const result = await resolver.investment('inv-uuid-1', mockUser);

      expect(result.id).toBe('inv-uuid-1');
    });

    it('should throw NotFoundException for a missing investment', async () => {
      investmentRepoMock.findOne.mockResolvedValue(null);

      await expect(resolver.investment('bad-id', mockUser)).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when user does not own the investment', async () => {
      const otherUserInvestment = { ...pendingInvestment, investorId: 'other-user-uuid' } as any;
      investmentRepoMock.findOne.mockResolvedValue(otherUserInvestment);

      await expect(resolver.investment('inv-uuid-1', mockUser)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('createInvestment()', () => {
    const input = {
      tradeDealId: 'deal-uuid-1',
      tokenAmount: 5,
      amountUsd: 500,
    };

    it('should delegate to InvestmentsService and publish funding update', async () => {
      investmentsServiceMock.createInvestment.mockResolvedValue({
        investment: pendingInvestment,
        unsignedXdr: 'xdr...',
        feeBreakdown: {},
      });
      dealRepoMock.findOne.mockResolvedValue(mockDeal);
      pubSubMock.publish.mockResolvedValue(undefined);

      const result = await resolver.createInvestment(input, mockUser);

      expect(result.id).toBe('inv-uuid-1');
      expect(investmentsServiceMock.createInvestment).toHaveBeenCalledWith(
        mockUser.id,
        input,
      );
      expect(pubSubMock.publish).toHaveBeenCalledWith(
        'dealFundingUpdated',
        expect.objectContaining({
          dealFundingUpdated: expect.objectContaining({ dealId: 'deal-uuid-1' }),
        }),
      );
    });

    it('should succeed even when deal is not found after creation', async () => {
      investmentsServiceMock.createInvestment.mockResolvedValue({
        investment: pendingInvestment,
        unsignedXdr: 'xdr...',
        feeBreakdown: {},
      });
      dealRepoMock.findOne.mockResolvedValue(null);

      const result = await resolver.createInvestment(input, mockUser);

      expect(result.id).toBe('inv-uuid-1');
      expect(pubSubMock.publish).not.toHaveBeenCalled();
    });
  });

  describe('cancelInvestment()', () => {
    it('should cancel a PENDING investment', async () => {
      const saved = { ...pendingInvestment, status: InvestmentStatus.CANCELLED };
      investmentRepoMock.findOne.mockResolvedValue(pendingInvestment);
      investmentRepoMock.save.mockResolvedValue(saved);

      const result = await resolver.cancelInvestment('inv-uuid-1', mockUser);

      expect(result.status).toBe(InvestmentStatus.CANCELLED);
    });

    it('should cancel a CONFIRMED investment', async () => {
      const saved = { ...confirmedInvestment, status: InvestmentStatus.CANCELLED };
      investmentRepoMock.findOne.mockResolvedValue(confirmedInvestment);
      investmentRepoMock.save.mockResolvedValue(saved);

      const result = await resolver.cancelInvestment('inv-uuid-2', mockUser);

      expect(result.status).toBe(InvestmentStatus.CANCELLED);
    });

    it('should throw ForbiddenException for ACTIVE investments', async () => {
      investmentRepoMock.findOne.mockResolvedValue(activeInvestment);

      await expect(resolver.cancelInvestment('inv-uuid-3', mockUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw NotFoundException for missing investment', async () => {
      investmentRepoMock.findOne.mockResolvedValue(null);

      await expect(resolver.cancelInvestment('bad-id', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when user does not own the investment', async () => {
      const other = { ...pendingInvestment, investorId: 'other-uuid' } as any;
      investmentRepoMock.findOne.mockResolvedValue(other);

      await expect(resolver.cancelInvestment('inv-uuid-1', mockUser)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('resolveInvestor()', () => {
    it('should delegate to the user DataLoader', async () => {
      const gqlInvestment = { investorId: 'investor-uuid' } as any;
      (mockCtx.loaders.user.load as jest.Mock).mockResolvedValue({ id: 'investor-uuid' });

      const result = await resolver.resolveInvestor(gqlInvestment, mockCtx);

      expect(mockCtx.loaders.user.load).toHaveBeenCalledWith('investor-uuid');
      expect(result?.id).toBe('investor-uuid');
    });
  });

  describe('resolveTradeDeal()', () => {
    it('should delegate to the deal DataLoader', async () => {
      const gqlInvestment = { tradeDealId: 'deal-uuid-1' } as any;
      (mockCtx.loaders.deal.load as jest.Mock).mockResolvedValue({ id: 'deal-uuid-1' });

      const result = await resolver.resolveTradeDeal(gqlInvestment, mockCtx);

      expect(mockCtx.loaders.deal.load).toHaveBeenCalledWith('deal-uuid-1');
      expect(result?.id).toBe('deal-uuid-1');
    });
  });
});
