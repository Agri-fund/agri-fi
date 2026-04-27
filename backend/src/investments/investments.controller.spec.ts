import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../auth/roles.guard';
import { InvestmentsController } from './investments.controller';
import { InvestmentsService } from './investments.service';
import { StellarService } from '../stellar/stellar.service';
import { CreateInvestmentDto } from './dto/create-investment.dto';

const mockInvestmentsService = {
  createInvestment: jest.fn(),
};

const mockStellarService = {} as StellarService;

describe('InvestmentsController', () => {
  let controller: InvestmentsController;
  let rolesGuard: RolesGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new InvestmentsController(
      mockInvestmentsService as unknown as InvestmentsService,
      mockStellarService,
    );
    rolesGuard = new RolesGuard(new Reflector());
  });

  it('delegates investment creation to the service for investor role', async () => {
    const request = { user: { id: 'investor-1', role: 'investor' } };
    const dto: CreateInvestmentDto = {
      tradeDealId: '11111111-1111-1111-1111-111111111111',
      tokenAmount: 5,
      amountUsd: 500,
    };
    const expected = { id: 'investment-1' };
    mockInvestmentsService.createInvestment.mockResolvedValue(expected);

    const result = await controller.createInvestment(request as any, dto);

    expect(result).toEqual(expected);
    expect(mockInvestmentsService.createInvestment).toHaveBeenCalledWith(
      'investor-1',
      dto,
    );
  });

  it('rejects non-investors in RolesGuard before the handler runs', () => {
    const context = {
      getHandler: () => InvestmentsController.prototype.createInvestment,
      getClass: () => InvestmentsController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 'trader-1', role: 'trader' },
        }),
      }),
    } as unknown as ExecutionContext;

    expect(() => rolesGuard.canActivate(context)).toThrow(ForbiddenException);
    expect(mockInvestmentsService.createInvestment).not.toHaveBeenCalled();
  });
});
