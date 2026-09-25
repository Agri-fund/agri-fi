import { DealDeploymentService } from './deal-deployment.service';

describe('DealDeploymentService', () => {
  let service: DealDeploymentService;
  let tradeDealRepo: any;
  let sorobanService: any;
  let feeConfigurationService: any;
  let auditService: any;
  let queueService: any;

  const makeDeal = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'deal-1',
      status: 'draft',
      commodity: 'Cocoa',
      totalValue: 100,
      minimumFundingTarget: 100,
      fundingDeadline: new Date('2026-02-01T00:00:00.000Z'),
      deliveryDate: new Date('2026-02-01T00:00:00.000Z'),
      farmer: { walletAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890' },
      ...overrides,
    }) as any;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    tradeDealRepo = {
      findOne: jest.fn().mockResolvedValue(makeDeal()),
      save: jest.fn().mockImplementation(async (deal) => deal),
      update: jest.fn().mockResolvedValue(undefined),
    };
    sorobanService = {
      deployFarmCampaign: jest.fn().mockResolvedValue('CCAMPAIGN'),
      platformPublicKey: jest.fn().mockReturnValue('GDEPLOYER'),
    };
    feeConfigurationService = {
      getPlatformOriginationFeeBps: jest.fn().mockResolvedValue(200),
    };
    auditService = {
      logEvent: jest.fn().mockResolvedValue(undefined),
    };
    queueService = {
      emit: jest.fn().mockResolvedValue(undefined),
    };

    service = new DealDeploymentService(
      tradeDealRepo,
      sorobanService,
      feeConfigurationService,
      auditService,
      queueService,
      {
        get: jest.fn((key: string) => {
          if (key === 'SOROBAN_FACTORY_CONTRACT_ID') return 'CFACTORY';
          if (key === 'SOROBAN_RPC_URL') return 'https://soroban-testnet.stellar.org';
          return undefined;
        }),
      } as any,
      {
        setContext: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
      } as any,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('passes a positive target, future deadline, and configured fee to the factory', async () => {
    const result = await service.approveDeal('deal-1', 'admin-1');

    expect(feeConfigurationService.getPlatformOriginationFeeBps).toHaveBeenCalledWith(
      'Cocoa',
    );
    expect(sorobanService.deployFarmCampaign).toHaveBeenCalledWith('deal-1', {
      farmerAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
      targetAmount: 1_000_000_000n,
      deadline: Math.floor(new Date('2026-02-01T00:00:00.000Z').getTime() / 1000),
      feeBps: 200,
    });
    expect(result.status).toBe('open');
  });

  it('rejects a non-positive target before deployment', async () => {
    tradeDealRepo.findOne.mockResolvedValue(
      makeDeal({ minimumFundingTarget: 0 }),
    );

    await expect(service.approveDeal('deal-1', 'admin-1')).rejects.toMatchObject({
      response: { code: 'INVALID_CAMPAIGN_TARGET' },
    });
    expect(sorobanService.deployFarmCampaign).not.toHaveBeenCalled();
  });

  it('rejects a deadline that is not in the future', async () => {
    tradeDealRepo.findOne.mockResolvedValue(
      makeDeal({ fundingDeadline: new Date('2025-12-31T00:00:00.000Z') }),
    );

    await expect(service.approveDeal('deal-1', 'admin-1')).rejects.toMatchObject({
      response: { code: 'INVALID_CAMPAIGN_DEADLINE' },
    });
    expect(sorobanService.deployFarmCampaign).not.toHaveBeenCalled();
  });

  it('rejects a fee above the shared bps cap before deployment', async () => {
    feeConfigurationService.getPlatformOriginationFeeBps.mockResolvedValue(10001);

    await expect(service.approveDeal('deal-1', 'admin-1')).rejects.toMatchObject({
      response: { code: 'INVALID_CAMPAIGN_FEE_BPS' },
    });
    expect(sorobanService.deployFarmCampaign).not.toHaveBeenCalled();
  });
});
