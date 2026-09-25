/**
 * Focused unit tests for InvestmentsService.requestCoolingOffCancel (#788).
 *
 * Constructs the service directly rather than through investments.service.spec.ts's
 * shared Test.createTestingModule beforeEach — that shared setup is currently broken
 * (missing an OfacSanctionsCheckService provider, pre-existing and unrelated to this
 * change) and fails all of its own tests before this change.
 */
import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InvestmentsService } from './investments.service';
import { InvestmentStatus } from './entities/investment.entity';

function makePendingInvestment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'inv-1',
    investorId: 'investor-1',
    status: InvestmentStatus.PENDING,
    createdAt: new Date(),
    amountUsd: 1000,
    ...overrides,
  };
}

describe('InvestmentsService.requestCoolingOffCancel', () => {
  let investmentRepo: { findOne: jest.Mock; update: jest.Mock };
  let eventStore: { append: jest.Mock };
  let configService: { get: jest.Mock };
  let service: InvestmentsService;

  beforeEach(() => {
    investmentRepo = { findOne: jest.fn(), update: jest.fn() };
    eventStore = { append: jest.fn().mockResolvedValue(undefined) };
    configService = { get: jest.fn().mockReturnValue(undefined) };
    service = new InvestmentsService(
      investmentRepo as any,
      {} as any, // tradeDealRepo
      {} as any, // userRepo
      {} as any, // stellarService
      {} as any, // dataSource
      {} as any, // queueService
      {} as any, // feeCalculatorService
      {} as any, // ofacCheckService
      undefined, // emailSequenceService
      eventStore as any,
      configService as any,
    );
  });

  it('throws NotFoundException when the investment does not exist', async () => {
    investmentRepo.findOne.mockResolvedValue(null);
    await expect(
      service.requestCoolingOffCancel('investor-1', 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws ForbiddenException when the caller doesn't own the investment", async () => {
    investmentRepo.findOne.mockResolvedValue(makePendingInvestment({ investorId: 'someone-else' }));
    await expect(
      service.requestCoolingOffCancel('investor-1', 'inv-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects with NOT_CANCELLABLE when the investment is no longer pending', async () => {
    investmentRepo.findOne.mockResolvedValue(
      makePendingInvestment({ status: InvestmentStatus.CONFIRMED }),
    );
    await expect(
      service.requestCoolingOffCancel('investor-1', 'inv-1'),
    ).rejects.toMatchObject({
      response: { code: 'NOT_CANCELLABLE' },
    });
    expect(investmentRepo.update).not.toHaveBeenCalled();
  });

  it('rejects with COOLING_OFF_EXPIRED once the default 48h window has passed', async () => {
    const createdAt = new Date();
    createdAt.setHours(createdAt.getHours() - 49);
    investmentRepo.findOne.mockResolvedValue(makePendingInvestment({ createdAt }));

    await expect(
      service.requestCoolingOffCancel('investor-1', 'inv-1'),
    ).rejects.toMatchObject({
      response: { code: 'COOLING_OFF_EXPIRED' },
    });
    expect(investmentRepo.update).not.toHaveBeenCalled();
  });

  it('respects a configured INVESTMENT_COOLING_OFF_HOURS override', async () => {
    configService.get.mockReturnValue('12');
    const createdAt = new Date();
    createdAt.setHours(createdAt.getHours() - 13);
    investmentRepo.findOne.mockResolvedValue(makePendingInvestment({ createdAt }));

    await expect(
      service.requestCoolingOffCancel('investor-1', 'inv-1'),
    ).rejects.toMatchObject({
      response: { code: 'COOLING_OFF_EXPIRED' },
    });
  });

  it('cancels a pending investment within the window and records an audit event', async () => {
    const pending = makePendingInvestment();
    investmentRepo.findOne
      .mockResolvedValueOnce(pending) // initial lookup
      .mockResolvedValueOnce({ ...pending, status: InvestmentStatus.CANCELLED }); // post-update reload
    investmentRepo.update.mockResolvedValue({ affected: 1 });

    const result = await service.requestCoolingOffCancel('investor-1', 'inv-1', 'changed my mind');

    expect(investmentRepo.update).toHaveBeenCalledWith(
      { id: 'inv-1', status: InvestmentStatus.PENDING },
      { status: InvestmentStatus.CANCELLED },
    );
    expect(eventStore.append).toHaveBeenCalledWith(
      'inv-1',
      'InvestmentCancelledByUser',
      { reason: 'changed my mind', withinCoolingOff: true },
      'investor-1',
    );
    expect(result.status).toBe(InvestmentStatus.CANCELLED);
  });

  it('rejects if a concurrent funding job already moved the investment off PENDING', async () => {
    investmentRepo.findOne.mockResolvedValue(makePendingInvestment());
    // The conditional update reports 0 rows affected: another writer (the
    // funding queue job) already changed the status between our read and
    // this update.
    investmentRepo.update.mockResolvedValue({ affected: 0 });

    await expect(
      service.requestCoolingOffCancel('investor-1', 'inv-1'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(eventStore.append).not.toHaveBeenCalled();
  });
});
