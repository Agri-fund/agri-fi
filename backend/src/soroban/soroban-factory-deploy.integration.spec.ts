/**
 * Integration test for FarmCampaign deployment through the ProjectFactory
 * contract on Stellar testnet (#830).
 *
 * SETUP: Run against testnet with a live Soroban RPC
 * - Requires STELLAR_PLATFORM_SECRET and SOROBAN_FACTORY_CONTRACT_ID env vars
 *   (the factory must be initialized with set_campaign_wasm_hash already set)
 * - Submits a real `deploy` invocation to Stellar testnet
 *
 * SKIP: Set SKIP_INTEGRATION_TESTS=true to skip in CI
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { SorobanService } from './soroban.service';

describe('Soroban ProjectFactory deploy integration (testnet)', () => {
  let service: SorobanService;

  beforeAll(async () => {
    if (process.env.SKIP_INTEGRATION_TESTS) {
      console.log('Skipping integration tests');
      return;
    }

    const mockConfig = {
      get: jest.fn((key: string, defaultValue?: string) => {
        switch (key) {
          case 'SOROBAN_RPC_URL':
            return (
              process.env.SOROBAN_RPC_URL ??
              'https://soroban-testnet.stellar.org'
            );
          case 'STELLAR_NETWORK':
            return process.env.STELLAR_NETWORK ?? 'testnet';
          case 'STELLAR_PLATFORM_SECRET':
            return process.env.STELLAR_PLATFORM_SECRET ?? '';
          case 'SOROBAN_FACTORY_CONTRACT_ID':
            return process.env.SOROBAN_FACTORY_CONTRACT_ID ?? '';
          default:
            return defaultValue;
        }
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: PinoLogger, useValue: { setContext: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } },
      ],
    }).compile();

    service = module.get<SorobanService>(SorobanService);
  });

  it('deploys a farm campaign and returns its contract address', async () => {
    if (process.env.SKIP_INTEGRATION_TESTS) return;
    if (!process.env.SOROBAN_FACTORY_CONTRACT_ID) {
      console.warn('SOROBAN_FACTORY_CONTRACT_ID not set; skipping deploy test');
      return;
    }

    const address = await service.deployFarmCampaign('deal-integration-830', {
      farmerAddress: service.platformPublicKey(),
      targetAmount: BigInt(Math.round(100 * 1e7)), // 100 USDC in stroops
      durationLedgers: 1000,
      commodityCode: 'COCOA',
    });

    expect(address).toMatch(/^C[A-Z2-7]{55}$/);
  });
});
