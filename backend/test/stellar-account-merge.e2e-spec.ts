import { Test, TestingModule } from '@nestjs/testing';
import { StellarService } from '../src/stellar/stellar.service';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TransactionLog } from '../src/stellar/entities/transaction-log.entity';
import { Keypair, Horizon } from '@stellar/stellar-sdk';
import axios from 'axios';

describe('Stellar Account Merge (e2e)', () => {
  const STELLAR_ENABLED = !!process.env.STELLAR_PLATFORM_SECRET;

  if (!STELLAR_ENABLED) {
    it.skip('skipped — STELLAR_PLATFORM_SECRET not configured', () => {});
    return;
  }

  let stellarService: StellarService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        StellarService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue: any) => {
              if (key === 'STELLAR_NETWORK') return 'testnet';
              if (key === 'STELLAR_HORIZON_URL')
                return 'https://horizon-testnet.stellar.org';
              if (key === 'ENCRYPTION_KEY')
                return '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
              return defaultValue;
            }),
          },
        },
        {
          provide: PinoLogger,
          useValue: {
            setContext: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(TransactionLog),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
          },
        },
      ],
    }).compile();

    stellarService = moduleFixture.get<StellarService>(StellarService);
  });

  jest.setTimeout(60000); // 60 seconds for testnet network calls

  it('should create temporary keypair on testnet, fund it, and merge it to destination', async () => {
    // 1. Create temporary keypairs
    const sourceKeypair = Keypair.random();
    const destKeypair = Keypair.random();

    // 2. Fund them on testnet using friendbot
    try {
      await axios.get(
        `https://friendbot.stellar.org?addr=${sourceKeypair.publicKey()}`,
      );
      await axios.get(
        `https://friendbot.stellar.org?addr=${destKeypair.publicKey()}`,
      );
    } catch (e) {
      console.warn(
        'Friendbot failed, skipping test if network is unreachable',
        e,
      );
      return;
    }

    const server = new Horizon.Server('https://horizon-testnet.stellar.org');

    // Check initial balance
    const destAccountBefore = await server.loadAccount(destKeypair.publicKey());
    const destBalanceBefore = parseFloat(
      destAccountBefore.balances.find((b) => b.asset_type === 'native')
        ?.balance || '0',
    );

    // 3. Execute account merge operation using the stellarService (if possible) or directly
    // stellarService.closeAccount requires an issuer/escrow account, but it zero out custom assets.
    // Let's use closeAccount directly:
    const txId = await stellarService.closeAccount(
      sourceKeypair.publicKey(),
      sourceKeypair.secret(),
      destKeypair.publicKey(),
    );

    expect(txId).toBeDefined();

    // 4. Verify account balance merges to destination wallet
    const destAccountAfter = await server.loadAccount(destKeypair.publicKey());
    const destBalanceAfter = parseFloat(
      destAccountAfter.balances.find((b) => b.asset_type === 'native')
        ?.balance || '0',
    );

    expect(destBalanceAfter).toBeGreaterThan(destBalanceBefore);

    // Verify source account is merged (not found)
    await expect(
      server.loadAccount(sourceKeypair.publicKey()),
    ).rejects.toThrow();
  });
});
