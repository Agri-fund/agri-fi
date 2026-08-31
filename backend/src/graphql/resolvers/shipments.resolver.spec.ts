/**
 * Unit tests for ShipmentsResolver.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ShipmentsResolver } from './shipments.resolver';
import { ShipmentMilestone } from '../../shipments/entities/shipment-milestone.entity';
import { GqlContext } from '../graphql.module';

const milestone1 = {
  id: 'ms-uuid-1',
  tradeDealId: 'deal-uuid',
  milestone: 'farm',
  recordedBy: 'trader-uuid',
  notes: 'Harvested',
  stellarTxId: null,
  memoText: null,
  latitude: 6.6885,
  longitude: -1.6244,
  recordedAt: new Date('2026-03-01'),
} as unknown as ShipmentMilestone;

const milestone2 = {
  ...milestone1,
  id: 'ms-uuid-2',
  milestone: 'warehouse',
  recordedAt: new Date('2026-03-15'),
} as unknown as ShipmentMilestone;

const milestoneRepoMock = { find: jest.fn() };

const mockCtx: GqlContext = {
  req: {} as any,
  res: {} as any,
  loaders: {
    user: { load: jest.fn() } as any,
    deal: { load: jest.fn() } as any,
  },
};

describe('ShipmentsResolver', () => {
  let resolver: ShipmentsResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShipmentsResolver,
        {
          provide: getRepositoryToken(ShipmentMilestone),
          useValue: milestoneRepoMock,
        },
      ],
    }).compile();

    resolver = module.get<ShipmentsResolver>(ShipmentsResolver);
    jest.clearAllMocks();
  });

  describe('shipments(tradeDealId)', () => {
    it('should return milestones in chronological order', async () => {
      milestoneRepoMock.find.mockResolvedValue([milestone1, milestone2]);

      const result = await resolver.shipments('deal-uuid');

      expect(result).toHaveLength(2);
      expect(result[0].milestone).toBe('farm');
      expect(result[1].milestone).toBe('warehouse');
      expect(milestoneRepoMock.find).toHaveBeenCalledWith({
        where: { tradeDealId: 'deal-uuid' },
        order: { recordedAt: 'ASC' },
      });
    });

    it('should return empty array when no milestones exist', async () => {
      milestoneRepoMock.find.mockResolvedValue([]);

      const result = await resolver.shipments('deal-uuid');

      expect(result).toEqual([]);
    });
  });

  describe('resolveTradeDeal()', () => {
    it('should delegate to the deal DataLoader', async () => {
      const gqlMilestone = { tradeDealId: 'deal-uuid' } as any;
      (mockCtx.loaders.deal.load as jest.Mock).mockResolvedValue({ id: 'deal-uuid' });

      const result = await resolver.resolveTradeDeal(gqlMilestone, mockCtx);

      expect(mockCtx.loaders.deal.load).toHaveBeenCalledWith('deal-uuid');
      expect(result?.id).toBe('deal-uuid');
    });
  });
});
