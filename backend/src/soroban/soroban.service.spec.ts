import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { SorobanService } from './soroban.service';

describe('SorobanService project factory deployment', () => {
  let service: SorobanService;
  let invoke: jest.SpyInstance;

  beforeEach(() => {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'SOROBAN_FACTORY_CONTRACT_ID') return 'CFACTORY';
        if (key === 'SOROBAN_RPC_URL') return 'https://soroban-testnet.stellar.org';
        if (key === 'STELLAR_NETWORK') return 'testnet';
        return '';
      }),
    } as unknown as ConfigService;
    const logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    } as unknown as PinoLogger;

    service = new SorobanService(config, logger);
    invoke = jest
      .spyOn(service, 'invokeContractWithResult')
      .mockResolvedValue({ hash: 'tx-hash', result: 'CCAMPAIGN' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const params = (
    overrides: Partial<{
      farmerAddress: string;
      targetAmount: bigint;
      deadline: number;
      feeBps: number;
    }> = {},
  ) => ({
    farmerAddress: service.platformPublicKey(),
    targetAmount: 1n,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    feeBps: 200,
    ...overrides,
  });

  it('encodes and invokes the validated create_campaign parameters', async () => {
    await expect(service.deployFarmCampaign('deal-1', params())).resolves.toBe(
      'CCAMPAIGN',
    );

    expect(invoke).toHaveBeenCalledWith(
      'CFACTORY',
      'create_campaign',
      expect.any(Array),
    );
    expect(invoke.mock.calls[0][2]).toHaveLength(5);
  });

  it('rejects a non-positive target before invoking the factory', async () => {
    await expect(
      service.deployFarmCampaign('deal-1', params({ targetAmount: 0n })),
    ).rejects.toThrow('Campaign target must be greater than zero');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects a deadline that is not in the future', async () => {
    await expect(
      service.deployFarmCampaign(
        'deal-1',
        params({ deadline: Math.floor(Date.now() / 1000) }),
      ),
    ).rejects.toThrow('Campaign deadline must be in the future');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects a fee above the shared cap', async () => {
    await expect(
      service.deployFarmCampaign('deal-1', params({ feeBps: 10001 })),
    ).rejects.toThrow('Campaign fee must be between 0 and 10000 bps');
    expect(invoke).not.toHaveBeenCalled();
  });
});
