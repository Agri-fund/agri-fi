import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SorobanRentService } from './soroban-rent.service';
import { SorobanService } from './soroban.service';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';

describe('SorobanRentService', () => {
  let service: SorobanRentService;
  let sorobanService: jest.Mocked<SorobanService>;
  let configService: jest.Mocked<ConfigService>;
  let tradeDealRepo: any;

  beforeEach(async () => {
    sorobanService = {
      getContractTtl: jest.fn(),
      extendContractTtl: jest.fn(),
      restoreArchivedContract: jest.fn(),
    } as any;

    configService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'SOROBAN_RPC_URL')
          return 'https://soroban-testnet.stellar.org';
        if (key === 'RENT_TOP_UP_LEDGERS_THRESHOLD') return 50000;
        if (key === 'SOROBAN_FACTORY_CONTRACT_ID') return 'CFACTORY123';
        return defaultValue;
      }),
    } as any;

    tradeDealRepo = {
      find: jest
        .fn()
        .mockResolvedValue([{ sorobanCampaignContractId: 'CCAMPAIGN456' }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanRentService,
        { provide: SorobanService, useValue: sorobanService },
        { provide: ConfigService, useValue: configService },
        { provide: getRepositoryToken(TradeDeal), useValue: tradeDealRepo },
      ],
    }).compile();

    service = module.get<SorobanRentService>(SorobanRentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should process TTL check and extend contract rent when below threshold', async () => {
    sorobanService.getContractTtl.mockResolvedValue(20000);
    sorobanService.extendContractTtl.mockResolvedValue('txhash123');

    await service.extendAllContractTtls();

    expect(sorobanService.extendContractTtl).toHaveBeenCalledWith(
      'CCAMPAIGN456',
      535680,
    );
    expect(sorobanService.extendContractTtl).toHaveBeenCalledWith(
      'CFACTORY123',
      535680,
    );
  });

  it('should handle contract TTL failure and log high priority alert', async () => {
    sorobanService.getContractTtl.mockRejectedValue(new Error('RPC Error'));

    await service.extendAllContractTtls();

    expect(sorobanService.extendContractTtl).not.toHaveBeenCalled();
  });

  it('should manually bump contract rent on demand', async () => {
    sorobanService.extendContractTtl.mockResolvedValue('txhash999');

    const result = await service.bumpContractRent('CCAMPAIGN789');

    expect(result).toBe('txhash999');
    expect(sorobanService.extendContractTtl).toHaveBeenCalledWith(
      'CCAMPAIGN789',
      535680,
    );
  });
});
