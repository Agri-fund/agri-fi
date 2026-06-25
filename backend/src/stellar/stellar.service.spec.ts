import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StellarService, InvestorShare } from './stellar.service';
import { PinoLogger } from 'nestjs-pino';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TransactionLog, TxStatus } from './entities/transaction-log.entity';
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
      ],
    }).compile();

    service = module.get<StellarService>(StellarService);
    (service as any).server = mockServer;
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
      (service as any).server = {
        loadAccount: jest.fn().mockResolvedValue(makeAccount('100', 1, true)),
      };

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
      (service as any).server = {
        loadAccount: jest.fn().mockResolvedValue(makeAccount('10', 0, false)),
      };

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
      (service as any).server = {
        loadAccount: jest.fn().mockResolvedValue(makeAccount('1', 0, false)),
      };

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
    it('should return "pending" for a 404 response', async () => {
      const mockError = { response: { status: 404 } };
      (service as any).server = {
        transactions: () => ({
          transaction: () => ({
            call: jest.fn().mockRejectedValue(mockError),
          }),
        }),
      };

      const status = await service.getTransactionStatus('nonexistent-tx-id');
      expect(status).toBe('pending');
    });

    it('should return "success" for a successful transaction', async () => {
      (service as any).server = {
        transactions: () => ({
          transaction: () => ({
            call: jest.fn().mockResolvedValue({ successful: true }),
          }),
        }),
      };

      const status = await service.getTransactionStatus('some-tx-id');
      expect(status).toBe('success');
    });

    it('should return "failed" for an unsuccessful transaction', async () => {
      (service as any).server = {
        transactions: () => ({
          transaction: () => ({
            call: jest.fn().mockResolvedValue({ successful: false }),
          }),
        }),
      };

      const status = await service.getTransactionStatus('some-tx-id');
      expect(status).toBe('failed');
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

      (service as any).server = {
        loadAccount: jest.fn().mockResolvedValue(mockAccount),
        submitTransaction: jest.fn().mockResolvedValue(mockTxResult),
      };

      const secret = 'SCM3CKKHLKTXOMML76C77C4OTVNE74CPUJJL32KNO3JAYZFVO544ENRP';
      const result = await service.transferTradeTokens(
        secret,
        'GDBLLCURMIMOM2YIQHHL7KVDDG4VUNXPRVVGTRS6GMJA47FLCX5NGSME',
        'GDBLLCURMIMOM2YIQHHL7KVDDG4VUNXPRVVGTRS6GMJA47FLCX5NGSME',
        'TOKEN',
        100,
      );

      expect(result).toBe('mock-tx-hash');
      expect((service as any).server.loadAccount).toHaveBeenCalledWith(
        'GDBLLCURMIMOM2YIQHHL7KVDDG4VUNXPRVVGTRS6GMJA47FLCX5NGSME',
      );
      expect((service as any).server.submitTransaction).toHaveBeenCalled();
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

    beforeEach(() => {
      (service as any).server = {
        loadAccount: jest.fn().mockResolvedValue(mockAccount),
        submitTransaction: jest
          .fn()
          .mockResolvedValue({ hash: 'freeze-tx-hash' }),
      };
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
      expect((service as any).server.loadAccount).toHaveBeenCalledWith(
        issuerKeypair.publicKey(),
      );
      expect((service as any).server.submitTransaction).toHaveBeenCalled();
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
      expect((service as any).server.submitTransaction).toHaveBeenCalled();
    });

    it('throws when Stellar submission fails', async () => {
      (service as any).server.submitTransaction = jest
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
      const encryptedEscrowSecret = service.encryptSecret(
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
    it('should encrypt and decrypt a secret symmetrically', () => {
      const originalSecret = Keypair.random().secret();
      const encrypted = service.encryptSecret(originalSecret);

      expect(encrypted).not.toBe(originalSecret);
      expect(encrypted).toContain(':');

      const decrypted = service.decryptSecret(encrypted);
      expect(decrypted).toBe(originalSecret);
    });

    it('should produce different ciphertext for same secret (random IV)', () => {
      const secret = Keypair.random().secret();
      const encrypted1 = service.encryptSecret(secret);
      const encrypted2 = service.encryptSecret(secret);

      expect(encrypted1).not.toBe(encrypted2);
      expect(service.decryptSecret(encrypted1)).toBe(secret);
      expect(service.decryptSecret(encrypted2)).toBe(secret);
    });

    it('should throw on decrypt with corrupted ciphertext', () => {
      const corrupted = 'invalid:hex:format';
      expect(() => service.decryptSecret(corrupted)).toThrow();
    });
  });
});
