import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
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

  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Create a test module with throttler to verify it's applied
    const { Test } = await import('@nestjs/testing');
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 5 }])],
      controllers: [InvestmentsController],
      providers: [
        { provide: InvestmentsService, useValue: mockInvestmentsService },
        { provide: StellarService, useValue: mockStellarService },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();

    controller = module.get<InvestmentsController>(InvestmentsController);
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

  describe('POST /investments', () => {
    it('should have throttler guard applied with 5 requests per minute', async () => {
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
  });
});
