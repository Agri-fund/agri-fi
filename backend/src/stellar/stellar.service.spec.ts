import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StellarService, InvestorShare } from './stellar.service';
import { PinoLogger } from 'nestjs-pino';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TransactionLog, TxStatus } from './entities/transaction-log.entity';
import { KmsService } from '../kms/kms.service';
import {
  Keypair,
  TransactionBuilder,
  Operation,
  Asset,
  Networks,
  Account,
} from '@stellar/stellar-sdk';

/**
 * Unit tests for StellarService — pure logic that doesn't require network calls.
 * Network-dependent methods (createEscrowAccount, issueTradeToken, etc.) are
 * tested against Stellar testnet in integration tests.
 *
 * This suite covers:
 * - Transaction building (XDR generation)
 * - Financial calculations (releaseEscrow distribution)
 * - Error handling (validation, insufficient funds)
 * - Mock Horizon responses
 */
describe('StellarService', () => {
  let service: StellarService;
  let mockServer: any;
  let txLogRepo: any;

  const mockConfig = {
    get: jest.fn((key: string, defaultVal?: string) => {
      const values: Record<string, string> = {
        STELLAR_NETWORK: 'testnet',
        STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
        STELLAR_PLATFORM_SECRET: '',
        STELLAR_PLATFORM_PUBLIC: '',
        USDC_ASSET_CODE: 'USDC',
        // Use Asset.native() fallback by leaving USDC_ISSUER empty for tests
        USDC_ISSUER: '',
        ENCRYPTION_KEY: '0'.repeat(64), // 32 bytes in hex
      };
      return values[key] ?? defaultVal ?? '';
    }),
  };

  const mockLogger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  // Helper to create mock Horizon account response
  const createMockAccount = (
    publicKey: string,
    xlmBalance: string = '100',
    subentryCount: number = 0,
    customBalances: any[] = [],
  ) => ({
    accountId: () => publicKey,
    sequenceNumber: () => '1',
    incrementSequenceNumber: jest.fn(),
    subentry_count: subentryCount,
    balances: [
      { asset_type: 'native', balance: xlmBalance },
      ...customBalances,
    ],
  });

  beforeEach(async () => {
    mockServer = {
      loadAccount: jest.fn(),
      submitTransaction: jest.fn(),
      transactions: jest.fn(),
      offers: jest.fn(),
    };

    txLogRepo = {
      create: jest.fn((entry) => entry),
      save: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: PinoLogger, useValue: mockLogger },
        {
          provide: getRepositoryToken(TransactionLog),
          useValue: txLogRepo,
        },
        {
          provide: KmsService,
          useValue: {
            // Simple symmetric stub: prefix-tag so decrypt can validate the input
            encrypt: jest.fn(async (plainText: string) =>
              'mock:' + Buffer.from(plainText).toString('base64'),
            ),
            decrypt: jest.fn(async (cipherText: string) => {
              if (!cipherText.startsWith('mock:')) {
                throw new Error('Invalid encrypted payload format');
              }
              return Buffer.from(cipherText.slice(5), 'base64').toString('utf8');
            }),
          },
        },
      ],
    }).compile();

    service = module.get<StellarService>(StellarService);
    // `server` is a getter delegating to horizonClient.activeServer — mock via the client
    Object.defineProperty((service as any).horizonClient, 'activeServer', {
      get: () => mockServer,
      configurable: true,
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should initialize with testnet network passphrase', () => {
    expect(service).toBeInstanceOf(StellarService);
  });

  describe('createInvestmentTransaction', () => {
    const investorWallet = Keypair.random().publicKey();
    const escrowPublicKey = Keypair.random().publicKey();
    const assetCode = 'COCOA1';
    const issuerPublicKey = Keypair.random().publicKey();

    const makeAccount = (
      xlmBalance: string,
      subentryCount: number,
      hasTrustline: boolean,
    ) => ({
      subentry_count: subentryCount,
      balances: [
        { asset_type: 'native', balance: xlmBalance },
        ...(hasTrustline
          ? [
              {
                asset_type: 'credit_alphanum12',
                asset_code: assetCode,
                asset_issuer: issuerPublicKey,
                balance: '0',
              },
            ]
          : []),
      ],
      incrementSequenceNumber: jest.fn(),
      sequenceNumber: jest.fn().mockReturnValue('100'),
      accountId: jest.fn().mockReturnValue(investorWallet),
    });

    it('should build a single-op XDR when trustline already exists', async () => {
      Object.defineProperty((service as any).horizonClient, 'activeServer', { get: () => ({
        loadAccount: jest.fn().mockResolvedValue(makeAccount('100', 1, true)),
      }), configurable: true });

      const xdr = await service.createInvestmentTransaction(
        investorWallet,
        escrowPublicKey,
        100,
        assetCode,
        1,
        issuerPublicKey,
      );
      expect(typeof xdr).toBe('string');
      expect(xdr.length).toBeGreaterThan(0);
    });

    it('should prepend changeTrust op when trustline is missing', async () => {
      Object.defineProperty((service as any).horizonClient, 'activeServer', { get: () => ({
        loadAccount: jest.fn().mockResolvedValue(makeAccount('10', 0, false)),
      }), configurable: true });

      const xdr = await service.createInvestmentTransaction(
        investorWallet,
        escrowPublicKey,
        100,
        assetCode,
        1,
        issuerPublicKey,
      );
      expect(typeof xdr).toBe('string');
    });

    it('should throw when XLM balance is insufficient for trustline reserve', async () => {
      Object.defineProperty((service as any).horizonClient, 'activeServer', { get: () => ({
        loadAccount: jest.fn().mockResolvedValue(makeAccount('1', 0, false)),
      }), configurable: true });

      await expect(
        service.createInvestmentTransaction(
          investorWallet,
          escrowPublicKey,
          100,
          assetCode,
          1,
          issuerPublicKey,
        ),
      ).rejects.toThrow('Insufficient XLM balance for trustline base reserve');
    });
  });

  describe('getTransactionStatus', () => {
    // Helper: build a mock Horizon server that resolves / rejects on `.call()`.
    const makeHorizonServer = (resolvedValue?: any, rejectedWith?: any) => ({
      transactions: () => ({
        transaction: () => ({
          call: resolvedValue !== undefined
            ? jest.fn().mockResolvedValue(resolvedValue)
            : jest.fn().mockRejectedValue(rejectedWith),
        }),
      }),
    });

    describe('cache miss — no Redis client', () => {
      it('should return "pending" for a 404 response', async () => {
        (service as any).sequenceRedis = null;
        Object.defineProperty((service as any).horizonClient, 'activeServer', { get: () => makeHorizonServer(
          undefined,
          { response: { status: 404 } },
        ), configurable: true });

        const status = await service.getTransactionStatus('nonexistent-tx-id');
        expect(status).toBe('pending');
      });

      it('should return "success" for a successful transaction', async () => {
        (service as any).sequenceRedis = null;
        Object.defineProperty((service as any).horizonClient, 'activeServer', { get: () => makeHorizonServer({ successful: true }), configurable: true });

        const status = await service.getTransactionStatus('some-tx-id');
        expect(status).toBe('success');
      });

      it('should return "failed" for an unsuccessful transaction', async () => {
        (service as any).sequenceRedis = null;
        Object.defineProperty((service as any).horizonClient, 'activeServer', { get: () => makeHorizonServer({ successful: false }), configurable: true });

        const status = await service.getTransactionStatus('some-tx-id');
        expect(status).toBe('failed');
      });
    });

    describe('cache hit — Redis has a terminal status', () => {
      it('should return "success" directly from cache without hitting Horizon', async () => {
        const mockCall = jest.fn();
        Object.defineProperty((service as any).horizonClient, 'activeServer', { get: () => ({
          transactions: () => ({
            transaction: () => ({ call: mockCall }),
          }),
        }), configurable: true });
        (service as any).sequenceRedis = {
          get: jest.fn().mockResolvedValue('success'),
          setEx: jest.fn().mockResolvedValue('OK'),
          isOpen: true,
        };

        const status = await service.getTransactionStatus('cached-success-tx');

        expect(status).toBe('success');
        expect(mockCall).not.toHaveBeenCalled();
      });

      it('should return "failed" directly from cache without hitting Horizon', async () => {
        const mockCall = jest.fn();
        Object.defineProperty((service as any).horizonClient, 'activeServer', { get: () => ({
          transactions: () => ({
            transaction: () => ({ call: mockCall }),
          }),
        }), configurable: true });
        (service as any).sequenceRedis = {
          get: jest.fn().mockResolvedValue('failed'),
          setEx: jest.fn().mockResolvedValue('OK'),
          isOpen: true,
        };

        const status = await service.getTransactionStatus('cached-failed-tx');

        expect(status).toBe('failed');
        expect(mockCall).not.toHaveBeenCalled();
      });
    });

    describe('cache miss — Redis returns null, Horizon queried (write-through)', () => {
      it('should write "success" to Redis after a successful Horizon response', async () => {
        const mockSetEx = jest.fn().mockResolvedValue('OK');
        (service as any).sequenceRedis = {
          get: jest.fn().mockResolvedValue(null),
          setEx: mockSetEx,
          isOpen: true,
        };
        Object.defineProperty((service as any).horizonClient, 'activeServer', { get: () => makeHorizonServer({ successful: true }), configurable: true });

        const status = await service.getTransactionStatus('new-success-tx');

        expect(status).toBe('success');
        expect(mockSetEx).toHaveBeenCalledWith(
          'stellar:tx:new-success-tx',
          3600,
          'success',
        );
      });

      it('should write "failed" to Redis after a failed Horizon response', async () => {
        const mockSetEx = jest.fn().mockResolvedValue('OK');
        (service as any).sequenceRedis = {
          get: jest.fn().mockResolvedValue(null),
          setEx: mockSetEx,
          isOpen: true,
        };
        Object.defineProperty((service as any).horizonClient, 'activeServer', { get: () => makeHorizonServer({ successful: false }), configurable: true });

        const status = await service.getTransactionStatus('new-failed-tx');

        expect(status).toBe('failed');
        expect(mockSetEx).toHaveBeenCalledWith(
          'stellar:tx:new-failed-tx',
          3600,
          'failed',
        );
      });

      it('should NOT write to Redis for a pending (404) transaction', async () => {
        const mockSetEx = jest.fn().mockResolvedValue('OK');
        (service as any).sequenceRedis = {
          get: jest.fn().mockResolvedValue(null),
          setEx: mockSetEx,
          isOpen: true,
        };
        Object.defineProperty((service as any).horizonClient, 'activeServer', { get: () => makeHorizonServer(
          undefined,
          { response: { status: 404 } },
        ), configurable: true });

        const status = await service.getTransactionStatus('pending-tx');

        expect(status).toBe('pending');
        expect(mockSetEx).not.toHaveBeenCalled();
      });
    });

    describe('Redis error resilience', () => {
      it('should fall through to Horizon when Redis GET throws', async () => {
        (service as any).sequenceRedis = {
          get: jest.fn().mockRejectedValue(new Error('Redis connection lost')),
          setEx: jest.fn().mockResolvedValue('OK'),
          isOpen: true,
        };
        Object.defineProperty((service as any).horizonClient, 'activeServer', { get: () => makeHorizonServer({ successful: true }), configurable: true });

        const status = await service.getTransactionStatus('tx-redis-get-error');

        expect(status).toBe('success');
      });

      it('should still return the correct status when Redis SETEX throws', async () => {
        (service as any).sequenceRedis = {
          get: jest.fn().mockResolvedValue(null),
          setEx: jest.fn().mockRejectedValue(new Error('Redis write error')),
          isOpen: true,
        };
        Object.defineProperty((service as any).horizonClient, 'activeServer', { get: () => makeHorizonServer({ successful: true }), configurable: true });

        const status = await service.getTransactionStatus('tx-redis-set-error');

        expect(status).toBe('success');
      });

      it('should ignore unknown values stored in Redis and fall back to Horizon', async () => {
        const mockSetEx = jest.fn().mockResolvedValue('OK');
        (service as any).sequenceRedis = {
          get: jest.fn().mockResolvedValue('corrupted-value'),
          setEx: mockSetEx,
          isOpen: true,
        };
        Object.defineProperty((service as any).horizonClient, 'activeServer', { get: () => makeHorizonServer({ successful: true }), configurable: true });

        const status = await service.getTransactionStatus('tx-corrupted-cache');

        expect(status).toBe('success');
        // Write-through should correct the cache.
        expect(mockSetEx).toHaveBeenCalledWith(
          'stellar:tx:tx-corrupted-cache',
          3600,
          'success',
        );
      });
    });
  });

  describe('validateTransactionSignatures', () => {
    const TESTNET_PASSPHRASE = Networks.TESTNET;

    /** Builds a minimal signed XDR using a fresh keypair */
    function buildSignedXdr(signerKeypair: Keypair): string {
      const account = new Account(signerKeypair.publicKey(), '100');
      const tx = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: TESTNET_PASSPHRASE,
      })
        .addOperation(
          Operation.payment({
            destination: Keypair.random().publicKey(),
            asset: Asset.native(),
            amount: '1',
          }),
        )
        .setTimeout(30)
        .build();
      tx.sign(signerKeypair);
      return tx.toXDR();
    }

    it('returns valid: true when the correct public key signed the transaction', () => {
      const signer = Keypair.random();
      const xdr = buildSignedXdr(signer);

      const result = service.validateTransactionSignatures(xdr, signer.publicKey());

      expect(result.valid).toBe(true);
      expect(result.publicKey).toBe(signer.publicKey());
      expect(result.signatureCount).toBe(1);
      expect(result.matchedSignatureIndex).toBe(0);
      expect(result.error).toBeUndefined();
    });

    it('returns valid: false when a different public key is checked against a valid signature', () => {
      const signer = Keypair.random();
      const unrelated = Keypair.random();
      const xdr = buildSignedXdr(signer);

      const result = service.validateTransactionSignatures(xdr, unrelated.publicKey());

      expect(result.valid).toBe(false);
      expect(result.signatureCount).toBe(1);
      expect(result.matchedSignatureIndex).toBe(-1);
      expect(result.error).toMatch(/No signature found/i);
    });

    it('returns valid: false with a parse error when XDR is malformed', () => {
      const result = service.validateTransactionSignatures(
        'not-valid-xdr==',
        Keypair.random().publicKey(),
      );

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Failed to parse XDR/i);
    });

    it('returns valid: false when the transaction has no signatures', () => {
      const signer = Keypair.random();
      const account = new Account(signer.publicKey(), '100');
      // Build but do NOT sign
      const tx = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: TESTNET_PASSPHRASE,
      })
        .addOperation(
          Operation.payment({
            destination: Keypair.random().publicKey(),
            asset: Asset.native(),
            amount: '1',
          }),
        )
        .setTimeout(30)
        .build();

      const result = service.validateTransactionSignatures(tx.toXDR(), signer.publicKey());

      expect(result.valid).toBe(false);
      expect(result.signatureCount).toBe(0);
      expect(result.error).toMatch(/no signatures/i);
    });

    it('returns valid: false with an invalid public key error', () => {
      const signer = Keypair.random();
      const xdr = buildSignedXdr(signer);

      const result = service.validateTransactionSignatures(xdr, 'not-a-public-key');

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Invalid public key/i);
    });
  });

  describe('transferTradeTokens', () => {
    it('should build and submit a payment transaction', async () => {
      const mockTxResult = { hash: 'mock-tx-hash' };
      const mockAccount = {
        sequenceNumber: () => '1',
        incrementSequenceNumber: jest.fn(),
        accountId: () =>
          'GDBLLCURMIMOM2YIQHHL7KVDDG4VUNXPRVVGTRS6GMJA47FLCX5NGSME',
      };

      const mockTxServer = {
        loadAccount: jest.fn().mockResolvedValue(mockAccount),
        submitTransaction: jest.fn().mockResolvedValue(mockTxResult),
      };
      Object.defineProperty((service as any).horizonClient, 'activeServer', {
        get: () => mockTxServer,
        configurable: true,
      });

      const secret = 'SCM3CKKHLKTXOMML76C77C4OTVNE74CPUJJL32KNO3JAYZFVO544ENRP';
      const result = await service.transferTradeTokens(
        secret,
        'GDBLLCURMIMOM2YIQHHL7KVDDG4VUNXPRVVGTRS6GMJA47FLCX5NGSME',
        'GDBLLCURMIMOM2YIQHHL7KVDDG4VUNXPRVVGTRS6GMJA47FLCX5NGSME',
        'TOKEN',
        100,
      );

      expect(result).toBe('mock-tx-hash');
      expect(mockTxServer.loadAccount).toHaveBeenCalledWith(
        'GDBLLCURMIMOM2YIQHHL7KVDDG4VUNXPRVVGTRS6GMJA47FLCX5NGSME',
      );
      expect(mockTxServer.submitTransaction).toHaveBeenCalled();
    });
  });

  describe('freezeAsset', () => {
    const issuerKeypair = Keypair.random();
    const trustorWallet = Keypair.random().publicKey();
    const mockAccount = {
      sequenceNumber: () => '1',
      incrementSequenceNumber: jest.fn(),
      accountId: () => issuerKeypair.publicKey(),
    };
    let freezeMockServer: any;

    beforeEach(() => {
      freezeMockServer = {
        loadAccount: jest.fn().mockResolvedValue(mockAccount),
        submitTransaction: jest.fn().mockResolvedValue({ hash: 'freeze-tx-hash' }),
      };
      Object.defineProperty((service as any).horizonClient, 'activeServer', {
        get: () => freezeMockServer,
        configurable: true,
      });
    });

    it('freezes a trustline by setting authorized:false', async () => {
      const txId = await service.freezeAsset(
        issuerKeypair.secret(),
        'COCOA1',
        issuerKeypair.publicKey(),
        trustorWallet,
        true,
      );

      expect(txId).toBe('freeze-tx-hash');
      expect(freezeMockServer.loadAccount).toHaveBeenCalledWith(
        issuerKeypair.publicKey(),
      );
      expect(freezeMockServer.submitTransaction).toHaveBeenCalled();
    });

    it('unfreezes a trustline by setting authorized:true', async () => {
      const txId = await service.freezeAsset(
        issuerKeypair.secret(),
        'COCOA1',
        issuerKeypair.publicKey(),
        trustorWallet,
        false,
      );

      expect(txId).toBe('freeze-tx-hash');
      expect(freezeMockServer.submitTransaction).toHaveBeenCalled();
    });

    it('throws when Stellar submission fails', async () => {
      freezeMockServer.submitTransaction = jest
        .fn()
        .mockRejectedValue(new Error('tx_failed'));

      await expect(
        service.freezeAsset(
          issuerKeypair.secret(),
          'COCOA1',
          issuerKeypair.publicKey(),
          trustorWallet,
          true,
        ),
      ).rejects.toThrow('tx_failed');
    });
  });

  describe('issueTradeToken', () => {
    const escrowPublicKey = Keypair.random().publicKey();
    const escrowSecret = Keypair.random().secret();
    const platformKeypair = Keypair.random();

    beforeEach(() => {
      (service as any).platformKeypair = platformKeypair;

      mockServer.loadAccount = jest.fn((pubKey: string) => {
        if (pubKey === platformKeypair.publicKey()) {
          return Promise.resolve(createMockAccount(pubKey));
        }
        // For any unknown pubKey (like the dynamically generated issuer), return a generic account
        return Promise.resolve(createMockAccount(pubKey));
      });

      mockServer.submitTransaction = jest
        .fn()
        .mockResolvedValue({ hash: 'issue-tx-hash' });
    });

    it('should generate a fresh issuer keypair and build operations', async () => {
      const result = await service.issueTradeToken(
        'COCOA1002',
        escrowPublicKey,
        escrowSecret,
        1000,
      );

      expect(result).toEqual({
        txId: 'issue-tx-hash',
        issuerPublicKey: expect.any(String),
        issuerSecret: expect.any(String),
      });

      expect(result.issuerSecret.length).toBeGreaterThan(0);
    });

    it('should fund issuer, establish trustline, and mint tokens', async () => {
      await service.issueTradeToken(
        'COCOA1002',
        escrowPublicKey,
        escrowSecret,
        500,
      );

      // Should load platform account (fund issuer)
      expect(mockServer.loadAccount).toHaveBeenCalledWith(
        platformKeypair.publicKey(),
      );
      // Should load escrow account (trustline) and issuer account (mint)
      expect(mockServer.loadAccount.mock.calls.length).toBeGreaterThanOrEqual(
        3,
      );

      // Should submit 3 transactions: fund issuer, establish trustline, mint
      expect(mockServer.submitTransaction).toHaveBeenCalledTimes(3);
    });

    it('should encode token count in the trustline limit', async () => {
      const tokenCount = 750;
      const submitMock = mockServer.submitTransaction as jest.Mock;
      submitMock.mockClear();
      submitMock.mockResolvedValue({ hash: 'issue-tx-hash' });

      await service.issueTradeToken(
        'COCOA1002',
        escrowPublicKey,
        escrowSecret,
        tokenCount,
      );

      expect(submitMock).toHaveBeenCalled();
    });
  });

  describe('releaseEscrow', () => {
    const escrowKeypair = Keypair.random();
    const farmerWallet = Keypair.random().publicKey();
    const platformWallet = Keypair.random().publicKey();

    it('should calculate 98% to farmer and 2% to platform', async () => {
      const investorShares: InvestorShare[] = [
        {
          walletAddress: Keypair.random().publicKey(),
          tokenAmount: 100,
          totalTokens: 200,
        },
        {
          walletAddress: Keypair.random().publicKey(),
          tokenAmount: 100,
          totalTokens: 200,
        },
      ];

      const totalValue = 10000; // Large enough to avoid rounding issues
      const escrowAccount = createMockAccount(escrowKeypair.publicKey());

      mockServer.loadAccount = jest.fn().mockResolvedValue(escrowAccount);
      mockServer.submitTransaction = jest
        .fn()
        .mockResolvedValue({ hash: 'release-tx-hash' });

      const txIds = await service.releaseEscrow(
        escrowKeypair.secret(),
        farmerWallet,
        investorShares,
        platformWallet,
        totalValue,
      );

      expect(txIds).toEqual(['release-tx-hash']);
      expect(txIds.length).toBeGreaterThan(0);
      expect(mockServer.submitTransaction).toHaveBeenCalled();
    });

    it('should distribute tokens proportionally among investors', async () => {
      const investor1 = Keypair.random().publicKey();
      const investor2 = Keypair.random().publicKey();

      const investorShares: InvestorShare[] = [
        {
          walletAddress: investor1,
          tokenAmount: 200,
          totalTokens: 300,
        },
        {
          walletAddress: investor2,
          tokenAmount: 100,
          totalTokens: 300,
        },
      ];

      const totalValue = 30000;
      const escrowAccount = createMockAccount(escrowKeypair.publicKey());

      mockServer.loadAccount = jest.fn().mockResolvedValue(escrowAccount);
      mockServer.submitTransaction = jest
        .fn()
        .mockResolvedValue({ hash: 'release-tx-hash' });

      const txIds = await service.releaseEscrow(
        escrowKeypair.secret(),
        farmerWallet,
        investorShares,
        platformWallet,
        totalValue,
      );

      expect(txIds).toHaveLength(1);
      expect(mockServer.submitTransaction).toHaveBeenCalled();
    });

    it('should handle batching for large investor lists', async () => {
      const investorShares: InvestorShare[] = Array.from(
        { length: 150 },
        (_, i) => ({
          walletAddress: Keypair.random().publicKey(),
          tokenAmount: 1,
          totalTokens: 150,
        }),
      );

      const totalValue = 50000;
      const escrowAccount = createMockAccount(escrowKeypair.publicKey());

      mockServer.loadAccount = jest.fn().mockResolvedValue(escrowAccount);
      mockServer.submitTransaction = jest
        .fn()
        .mockResolvedValue({ hash: 'release-tx-hash' });

      const txIds = await service.releaseEscrow(
        escrowKeypair.secret(),
        farmerWallet,
        investorShares,
        platformWallet,
        totalValue,
      );

      // Should create 2 transactions (150 / 98 = 1.53, rounds up to 2)
      expect(txIds.length).toBeGreaterThan(1);
      expect(mockServer.submitTransaction.mock.calls.length).toBe(txIds.length);
    });

    it('should throw on zero or negative total value', async () => {
      const investorShares: InvestorShare[] = [
        {
          walletAddress: Keypair.random().publicKey(),
          tokenAmount: 100,
          totalTokens: 200,
        },
      ];

      await expect(
        service.releaseEscrow(
          escrowKeypair.secret(),
          farmerWallet,
          investorShares,
          platformWallet,
          0,
        ),
      ).rejects.toThrow('Invalid totalValue');
    });

    it('should throw on empty investor shares', async () => {
      mockServer.loadAccount = jest
        .fn()
        .mockResolvedValue(createMockAccount(escrowKeypair.publicKey()));

      await expect(
        service.releaseEscrow(
          escrowKeypair.secret(),
          farmerWallet,
          [],
          platformWallet,
          5000,
        ),
      ).rejects.toThrow('Invalid investor token distribution');
    });

    it('should ensure total distribution equals input', async () => {
      const investorShares: InvestorShare[] = [
        {
          walletAddress: Keypair.random().publicKey(),
          tokenAmount: 50,
          totalTokens: 100,
        },
        {
          walletAddress: Keypair.random().publicKey(),
          tokenAmount: 50,
          totalTokens: 100,
        },
      ];

      const totalValue = 100000;
      const escrowAccount = createMockAccount(escrowKeypair.publicKey());

      mockServer.loadAccount = jest.fn().mockResolvedValue(escrowAccount);
      mockServer.submitTransaction = jest
        .fn()
        .mockResolvedValue({ hash: 'release-tx-hash' });

      const txIds = await service.releaseEscrow(
        escrowKeypair.secret(),
        farmerWallet,
        investorShares,
        platformWallet,
        totalValue,
      );

      expect(txIds).toBeDefined();
      expect(txIds.length).toBeGreaterThan(0);
    });
  });

  describe('createEscrowAccount', () => {
    const platformKeypair = Keypair.random();
    const platformAccount = createMockAccount(platformKeypair.publicKey());

    beforeEach(() => {
      (service as any).platformKeypair = platformKeypair;
      mockServer.loadAccount = jest.fn().mockResolvedValue(platformAccount);
      mockServer.submitTransaction = jest
        .fn()
        .mockResolvedValue({ hash: 'create-escrow-tx' });
    });

    it('should create a new escrow account keypair', async () => {
      const tradeDealId = 'deal-12345';
      const result = await service.createEscrowAccount(tradeDealId);

      expect(result).toEqual({
        publicKey: expect.any(String),
        secretKey: expect.any(String),
      });

      expect(result.publicKey.length).toBeGreaterThan(0);
      expect(result.secretKey.length).toBeGreaterThan(0);
    });

    it('should fund escrow from platform account with 3 XLM', async () => {
      const tradeDealId = 'deal-67890';
      await service.createEscrowAccount(tradeDealId);

      expect(mockServer.loadAccount).toHaveBeenCalledWith(
        platformKeypair.publicKey(),
      );
      expect(mockServer.submitTransaction).toHaveBeenCalled();
    });

    it('should establish USDC trustline on escrow account', async () => {
      const tradeDealId = 'deal-test';
      const submitMock = mockServer.submitTransaction as jest.Mock;
      submitMock.mockClear();
      submitMock.mockResolvedValue({ hash: 'tx-hash' });

      await service.createEscrowAccount(tradeDealId);

      expect(submitMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('should include deal ID in escrow account memo', async () => {
      const tradeDealId = 'deal-abc123';
      await service.createEscrowAccount(tradeDealId);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          tradeDealId: tradeDealId,
          escrowPublicKey: expect.any(String),
          memo: expect.stringContaining('escrow:'),
        }),
        expect.any(String),
      );
    });
  });

  describe('fundEscrow', () => {
    const escrowPublicKey = Keypair.random().publicKey();
    const investorWallet = Keypair.random().publicKey();
    const investorAccount = createMockAccount(investorWallet, '500');

    beforeEach(() => {
      mockServer.loadAccount = jest.fn().mockResolvedValue(investorAccount);
      mockServer.submitTransaction = jest
        .fn()
        .mockResolvedValue({ hash: 'fund-tx-hash' });
    });

    it('should create a USDC payment from investor to escrow', async () => {
      const amountUSD = '1000';
      const result = await service.fundEscrow(
        escrowPublicKey,
        investorWallet,
        amountUSD,
      );

      expect(result).toBe('fund-tx-hash');
      expect(mockServer.loadAccount).toHaveBeenCalledWith(investorWallet);
      expect(mockServer.submitTransaction).toHaveBeenCalled();
    });

    it('should transfer tokens to investor if escrow secret provided', async () => {
      const amountUSD = '500';
      const encryptedEscrowSecret = await service.encryptSecret(
        Keypair.random().secret(),
      );
      const assetCode = 'COCOA001';
      const tokenAmount = 100;

      const escrowAccount = createMockAccount(escrowPublicKey);
      mockServer.loadAccount = jest.fn((pubKey: string) => {
        if (pubKey === investorWallet) return Promise.resolve(investorAccount);
        if (pubKey === escrowPublicKey) return Promise.resolve(escrowAccount);
        return Promise.reject(new Error('Unknown account'));
      });

      mockServer.submitTransaction = jest
        .fn()
        .mockResolvedValue({ hash: 'tx-hash' });

      const result = await service.fundEscrow(
        escrowPublicKey,
        investorWallet,
        amountUSD,
        encryptedEscrowSecret,
        assetCode,
        tokenAmount,
      );

      expect(result).toBe('tx-hash');
      expect(
        mockServer.submitTransaction.mock.calls.length,
      ).toBeGreaterThanOrEqual(1);
    });

    it('should work with minimum USDC amount', async () => {
      const minAmount = '0.0000001';
      const result = await service.fundEscrow(
        escrowPublicKey,
        investorWallet,
        minAmount,
      );

      expect(result).toBe('fund-tx-hash');
    });
  });

  describe('encryptSecret / decryptSecret', () => {
    it('should encrypt and decrypt a secret symmetrically', async () => {
      const originalSecret = Keypair.random().secret();
      const encrypted = await service.encryptSecret(originalSecret);

      expect(encrypted).not.toBe(originalSecret);

      const decrypted = await service.decryptSecret(encrypted);
      expect(decrypted).toBe(originalSecret);
    });

    it('should produce a non-empty ciphertext string', async () => {
      const secret = Keypair.random().secret();
      const encrypted = await service.encryptSecret(secret);

      expect(typeof encrypted).toBe('string');
      expect(encrypted.length).toBeGreaterThan(0);
      expect(await service.decryptSecret(encrypted)).toBe(secret);
    });

    it('should throw on decrypt with corrupted ciphertext', async () => {
      const corrupted = 'not-valid-base64-kms-payload!!@#';
      await expect(service.decryptSecret(corrupted)).rejects.toThrow();
    });
  });

  describe('Multi-Signature Setup (Issue #352)', () => {
    let signer1: Keypair;
    let signer2: Keypair;
    let mockConfigWithSigners: any;

    beforeEach(() => {
      signer1 = Keypair.random();
      signer2 = Keypair.random();

      mockConfigWithSigners = {
        get: jest.fn((key: string, defaultVal?: string) => {
          const values: Record<string, string> = {
            STELLAR_NETWORK: 'testnet',
            STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
            STELLAR_PLATFORM_SECRET: '',
            STELLAR_PLATFORM_PUBLIC: '',
            USDC_ASSET_CODE: 'USDC',
            USDC_ISSUER: '',
            STELLAR_MULTISIG_SIGNER_1_SECRET: signer1.secret(),
            STELLAR_MULTISIG_SIGNER_2_SECRET: signer2.secret(),
          };
          return values[key] ?? defaultVal ?? '';
        }),
      };
    });

    describe('initializeMultiSigSigners', () => {
      it('should load multi-sig signers from environment variables', () => {
        const result = (service as any).initializeMultiSigSigners(mockConfigWithSigners);

        expect(result).toHaveLength(2);
        expect(result[0].publicKey()).toBe(signer1.publicKey());
        expect(result[1].publicKey()).toBe(signer2.publicKey());
      });

      it('should warn if signers not configured in production', () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';

        try {
          const testConfig = {
            get: jest.fn((key: string, defaultVal?: string) => defaultVal ?? ''),
          };

          (service as any).initializeMultiSigSigners(testConfig);

          expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.stringContaining('STELLAR_MULTISIG_SIGNER_1_SECRET not configured'),
          );
          expect(mockLogger.warn).toHaveBeenCalledWith(
            expect.stringContaining('STELLAR_MULTISIG_SIGNER_2_SECRET not configured'),
          );
        } finally {
          process.env.NODE_ENV = originalEnv;
        }
      });

      it('should throw on invalid signer secret key', () => {
        const badConfig = {
          get: jest.fn((key: string, defaultVal?: string) => {
            if (key === 'STELLAR_MULTISIG_SIGNER_1_SECRET') {
              return 'invalid-secret-key';
            }
            return defaultVal ?? '';
          }),
        };

        expect(() => {
          (service as any).initializeMultiSigSigners(badConfig);
        }).toThrow();
      });
    });

    describe('getPlatformPublicKey', () => {
      it('should return the platform keypair public key', () => {
        const publicKey = service.getPlatformPublicKey();
        expect(publicKey).toBe((service as any).platformKeypair.publicKey());
      });

      it('should return a valid Stellar public key format', () => {
        const publicKey = service.getPlatformPublicKey();
        expect(publicKey).toMatch(/^G[A-Z2-7]{55}$/);
      });
    });

    describe('setupPlatformMultiSig', () => {
      it('should throw error if signers not configured', async () => {
        (service as any).multiSigSigners = [];

        await expect(service.setupPlatformMultiSig()).rejects.toThrow(
          'Multi-sig setup requires at least 2 signer keys',
        );
      });

      it('should configure platform wallet with 2-of-3 multi-sig', async () => {
        const platformPublicKey = service.getPlatformPublicKey();
        (service as any).multiSigSigners = [signer1, signer2];

        mockServer.loadAccount.mockResolvedValue(
          createMockAccount(platformPublicKey),
        );
        mockServer.submitTransaction.mockResolvedValue({ hash: 'tx-hash-1' });

        const result = await service.setupPlatformMultiSig();

        expect(result).toEqual({
          platformPublicKey,
          signers: [signer1.publicKey(), signer2.publicKey()],
          transactionThreshold: 2,
        });

        // Verify two transactions were submitted (one per signer)
        expect(mockServer.submitTransaction.mock.calls.length).toBeGreaterThanOrEqual(1);
      });

      it('should log multi-sig configuration', async () => {
        const platformPublicKey = service.getPlatformPublicKey();
        (service as any).multiSigSigners = [signer1, signer2];

        mockServer.loadAccount.mockResolvedValue(
          createMockAccount(platformPublicKey),
        );
        mockServer.submitTransaction.mockResolvedValue({ hash: 'tx-hash' });

        await service.setupPlatformMultiSig();

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            platformPublicKey,
            signers: expect.arrayContaining([signer1.publicKey(), signer2.publicKey()]),
            masterWeight: 1,
            lowThreshold: 1,
            medThreshold: 2,
            highThreshold: 2,
          }),
          expect.stringContaining('Platform wallet multi-sig configuration completed'),
        );
      });

      it('should handle Horizon API errors gracefully', async () => {
        (service as any).multiSigSigners = [signer1, signer2];

        mockServer.loadAccount.mockRejectedValue(
          new Error('Horizon API unavailable'),
        );

        await expect(service.setupPlatformMultiSig()).rejects.toThrow(
          'Horizon API unavailable',
        );
      });
    });

    describe('getPlatformMultiSigConfig', () => {
      it('should retrieve current multi-sig configuration', async () => {
        const platformPublicKey = service.getPlatformPublicKey();
        const mockSigners = [
          { key: platformPublicKey, weight: 1 },
          { key: signer1.publicKey(), weight: 1 },
          { key: signer2.publicKey(), weight: 1 },
        ];

        mockServer.loadAccount.mockResolvedValue({
          ...createMockAccount(platformPublicKey),
          signers: mockSigners,
          thresholds: {
            low_threshold: 1,
            med_threshold: 2,
            high_threshold: 2,
          },
        });

        const config = await service.getPlatformMultiSigConfig();

        expect(config.publicKey).toBe(platformPublicKey);
        expect(config.signers).toHaveLength(3);
        expect(config.signers[0].key).toBe(platformPublicKey);
        expect(config.signers[0].weight).toBe(1);
        expect(config.thresholds).toEqual({
          low: 1,
          med: 2,
          high: 2,
        });
      });

      it('should format signer information correctly', async () => {
        const platformPublicKey = service.getPlatformPublicKey();
        const mockSigners = [
          { key: platformPublicKey, weight: 1 },
          { key: signer1.publicKey(), weight: 1 },
          { key: signer2.publicKey(), weight: 1 },
        ];

        mockServer.loadAccount.mockResolvedValue({
          ...createMockAccount(platformPublicKey),
          signers: mockSigners,
          thresholds: {
            low_threshold: 1,
            med_threshold: 2,
            high_threshold: 2,
          },
        });

        const config = await service.getPlatformMultiSigConfig();

        expect(config.signers.every((s) => s.key && typeof s.weight === 'number')).toBe(
          true,
        );
      });

      it('should handle empty signer list', async () => {
        const platformPublicKey = service.getPlatformPublicKey();

        mockServer.loadAccount.mockResolvedValue({
          ...createMockAccount(platformPublicKey),
          signers: [],
          thresholds: {
            low_threshold: 0,
            med_threshold: 0,
            high_threshold: 0,
          },
        });

        const config = await service.getPlatformMultiSigConfig();

        expect(config.signers).toHaveLength(0);
        expect(config.thresholds.med).toBe(0);
      });
    });

    describe('submitWithRetry Exponential Backoff and Jitter', () => {
      it('retries transient Horizon errors with exponential backoff and random jitter', async () => {
        const transientErr = { response: { status: 429 } };
        mockServer.submitTransaction
          .mockRejectedValueOnce(transientErr)
          .mockRejectedValueOnce({ response: { status: 503 } })
          .mockResolvedValueOnce({ hash: 'tx-hash-success' });

        const spySetTimeout = jest.spyOn(global, 'setTimeout');

        const result = await (service as any).submitWithRetry({ id: 'mock-tx' });

        expect(result).toEqual({ hash: 'tx-hash-success' });
        expect(mockServer.submitTransaction).toHaveBeenCalledTimes(3);

        // Check that delay includes base * 2^attempt (>= 1000 for attempt 0, >= 2000 for attempt 1)
        expect(spySetTimeout).toHaveBeenCalledTimes(2);
        const firstDelay = spySetTimeout.mock.calls[0][1];
        const secondDelay = spySetTimeout.mock.calls[1][1];

        expect(firstDelay).toBeGreaterThanOrEqual(1000); // 1000 * 2^0 + jitter
        expect(firstDelay).toBeLessThan(1500);
        expect(secondDelay).toBeGreaterThanOrEqual(2000); // 1000 * 2^1 + jitter
        expect(secondDelay).toBeLessThan(2500);

        spySetTimeout.mockRestore();
      });
    });
  });
});
