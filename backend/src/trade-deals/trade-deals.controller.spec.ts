import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { TradeDealsController } from './trade-deals.controller';
import { TradeDealsService } from './trade-deals.service';
import { OptionalJwtGuard } from '../auth/optional-jwt.guard';
import { TradeDealsGuard } from './trade-deals.guard';

const mockDeal = { id: 'deal-uuid', commodity: 'Cocoa', status: 'open' };
const paginatedDeal = {
  data: [mockDeal],
  meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
};

const mockService = {
  findOpen: jest.fn().mockResolvedValue(paginatedDeal),
  findOne: jest.fn().mockResolvedValue(mockDeal),
};

describe('TradeDealsController (public access)', () => {
  let controller: TradeDealsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TradeDealsController],
      providers: [{ provide: TradeDealsService, useValue: mockService }],
    })
      // Override OptionalJwtGuard to simulate unauthenticated request (user = null)
      .overrideGuard(OptionalJwtGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().user = null;
          return true;
        },
      })
      .overrideGuard(TradeDealsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TradeDealsController>(TradeDealsController);
  });

  describe('GET /trade-deals', () => {
    it('returns deals without authentication', async () => {
      const result = await controller.findOpen();
      expect(result).toEqual(paginatedDeal);
    });
  });

  describe('GET /trade-deals/:id', () => {
    it('returns deal without authentication', async () => {
      const result = await controller.findOne('deal-uuid', {} as any);
      expect(result).toEqual(mockDeal);
      expect(mockService.findOne).toHaveBeenCalledWith('deal-uuid', undefined);
    });

    it('returns deal with authenticated user (guard passes user through)', async () => {
      const module: TestingModule = await Test.createTestingModule({
        controllers: [TradeDealsController],
        providers: [{ provide: TradeDealsService, useValue: mockService }],
      })
        .overrideGuard(OptionalJwtGuard)
        .useValue({
          canActivate: (ctx: ExecutionContext) => {
            ctx.switchToHttp().getRequest().user = {
              id: 'user-uuid',
              role: 'investor',
            };
            return true;
          },
        })
        .overrideGuard(TradeDealsGuard)
        .useValue({
          canActivate: (ctx: ExecutionContext) => {
            ctx.switchToHttp().getRequest().tradeDealAccess = {
              isOwner: false,
              isInvestedInvestor: true,
              canViewSensitive: true,
            };
            return true;
          },
        })
        .compile();

      const authedController =
        module.get<TradeDealsController>(TradeDealsController);
      const result = await authedController.findOne('deal-uuid', {
        tradeDealAccess: {
          isOwner: false,
          isInvestedInvestor: true,
          canViewSensitive: true,
        },
      } as any);
      expect(result).toEqual(mockDeal);
    });
  });
});
