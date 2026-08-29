/**
 * Focused unit tests for InvestmentsService.getPortfolioSummary (#789).
 *
 * Constructs the service directly rather than through investments.service.spec.ts's
 * shared Test.createTestingModule beforeEach — that shared setup is currently broken
 * (missing an OfacSanctionsCheckService provider, pre-existing and unrelated to this
 * change) and fails all 19 of its own tests before this change. getPortfolioSummary
 * only touches investmentRepo, so it's constructed with that one real mock and
 * `as any` stand-ins for the rest.
 */
import { InvestmentsService } from './investments.service';
import { InvestmentStatus } from './entities/investment.entity';

function makeInvestment(overrides: Partial<Record<string, unknown>>) {
  return {
    id: 'inv-1',
    tradeDealId: 'deal-1',
    investorId: 'investor-1',
    amountUsd: 1000,
    status: InvestmentStatus.CONFIRMED,
    tradeDeal: { commodity: 'Maize', tokenSymbol: 'MAIZ', expectedRoi: 10 },
    ...overrides,
  };
}

describe('InvestmentsService.getPortfolioSummary', () => {
  let investmentRepo: { find: jest.Mock };
  let service: InvestmentsService;

  beforeEach(() => {
    investmentRepo = { find: jest.fn() };
    service = new InvestmentsService(
      investmentRepo as any,
      {} as any, // tradeDealRepo
      {} as any, // userRepo
      {} as any, // stellarService
      {} as any, // dataSource
      {} as any, // queueService
      {} as any, // feeCalculatorService
      {} as any, // ofacCheckService
      undefined, // emailSequenceService (optional)
      undefined, // eventStore (optional)
    );
  });

  it('returns zeroed totals with no investments', async () => {
    investmentRepo.find.mockResolvedValue([]);
    const summary = await service.getPortfolioSummary('investor-1');
    expect(summary).toEqual({
      totalInvested: 0,
      currentValue: 0,
      expectedReturns: 0,
      activeDealCount: 0,
      allocationByDeal: [],
    });
  });

  it('excludes pending, cancelled, failed, and refunded investments from totals', async () => {
    investmentRepo.find.mockResolvedValue([
      makeInvestment({ status: InvestmentStatus.PENDING, amountUsd: 500 }),
      makeInvestment({ status: InvestmentStatus.CANCELLED, amountUsd: 500 }),
      makeInvestment({ status: InvestmentStatus.FAILED, amountUsd: 500 }),
      makeInvestment({ status: InvestmentStatus.REFUNDED, amountUsd: 500 }),
      makeInvestment({ status: InvestmentStatus.CONFIRMED, amountUsd: 1000 }),
    ]);
    const summary = await service.getPortfolioSummary('investor-1');
    expect(summary.totalInvested).toBe(1000);
    expect(summary.activeDealCount).toBe(1);
  });

  it('grows currentValue by expectedRoi for completed investments but not for still-active ones', async () => {
    investmentRepo.find.mockResolvedValue([
      makeInvestment({
        id: 'a',
        tradeDealId: 'deal-a',
        status: InvestmentStatus.COMPLETED,
        amountUsd: 1000,
        tradeDeal: { commodity: 'Maize', tokenSymbol: 'MAIZ', expectedRoi: 20 },
      }),
      makeInvestment({
        id: 'b',
        tradeDealId: 'deal-b',
        status: InvestmentStatus.ACTIVE,
        amountUsd: 1000,
        tradeDeal: { commodity: 'Rice', tokenSymbol: 'RICE', expectedRoi: 20 },
      }),
    ]);
    const summary = await service.getPortfolioSummary('investor-1');
    // Completed: 1000 * 1.20 = 1200 realized. Active: 1000 cost basis (no
    // secondary-market price lookup in scope) since it hasn't completed yet.
    expect(summary.currentValue).toBe(1200 + 1000);
    expect(summary.expectedReturns).toBe(1200 + 1200);
    // activeDealCount excludes the completed deal.
    expect(summary.activeDealCount).toBe(1);
  });

  it('aggregates multiple investments in the same deal and computes allocation percentages', async () => {
    investmentRepo.find.mockResolvedValue([
      makeInvestment({ id: 'a', tradeDealId: 'deal-1', amountUsd: 3000 }),
      makeInvestment({ id: 'b', tradeDealId: 'deal-1', amountUsd: 1000 }),
      makeInvestment({
        id: 'c',
        tradeDealId: 'deal-2',
        amountUsd: 1000,
        tradeDeal: { commodity: 'Rice', tokenSymbol: 'RICE', expectedRoi: 5 },
      }),
    ]);
    const summary = await service.getPortfolioSummary('investor-1');
    expect(summary.totalInvested).toBe(5000);
    expect(summary.allocationByDeal).toEqual([
      { dealId: 'deal-1', commodity: 'Maize', tokenSymbol: 'MAIZ', amountUsd: 4000, percentage: 80 },
      { dealId: 'deal-2', commodity: 'Rice', tokenSymbol: 'RICE', amountUsd: 1000, percentage: 20 },
    ]);
  });
});
