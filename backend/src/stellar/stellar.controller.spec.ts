import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { StellarController } from './stellar.controller';
import { StellarService } from './stellar.service';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import {
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  Account,
} from '@stellar/stellar-sdk';

const mockStellarService = {
  submitTransaction: jest.fn(),
  setupPlatformMultiSig: jest.fn(),
  getPlatformMultiSigConfig: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key: string, defaultVal?: string) => {
    const values: Record<string, string> = {
      STELLAR_NETWORK: 'testnet',
    };
    return values[key] ?? defaultVal ?? '';
  }),
};

const mockRequest = (walletAddress: string | null, role: string = 'user') => ({
  user: { walletAddress, role },
});

describe('StellarController', () => {
  let controller: StellarController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 5 }])],
      controllers: [StellarController],
      providers: [
        { provide: StellarService, useValue: mockStellarService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();

    controller = module.get<StellarController>(StellarController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
  it('should throw 400 for invalid XDR', async () => {
    await expect(
      controller.submitTransaction(
        'not-valid-xdr',
        mockRequest('GXXXXXX') as any,
      ),
    ).rejects.toThrow(
      new HttpException(
        'Invalid XDR: transaction could not be decoded',
        HttpStatus.BAD_REQUEST,
      ),
    );
  });
  it('should throw 403 when caller has no linked wallet', async () => {
    const keypair = Keypair.random();
    const account = new Account(keypair.publicKey(), '0');
    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.inflation({}))
      .setTimeout(30)
      .build();
    tx.sign(keypair);
    const xdr = tx.toXDR();

    await expect(
      controller.submitTransaction(xdr, mockRequest(null) as any),
    ).rejects.toThrow(
      new HttpException(
        'No wallet address linked to your account',
        HttpStatus.FORBIDDEN,
      ),
    );
  });
  it('should throw 403 when source account does not match caller wallet', async () => {
    const keypair = Keypair.random();
    const account = new Account(keypair.publicKey(), '0');
    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.inflation({}))
      .setTimeout(30)
      .build();
    tx.sign(keypair);
    const xdr = tx.toXDR();

    const differentWallet = Keypair.random().publicKey();

    await expect(
      controller.submitTransaction(xdr, mockRequest(differentWallet) as any),
    ).rejects.toThrow(
      new HttpException(
        'Transaction source account does not match your linked wallet',
        HttpStatus.FORBIDDEN,
      ),
    );
  });
  it('should submit successfully when XDR is valid and source matches caller wallet', async () => {
    const keypair = Keypair.random();
    const account = new Account(keypair.publicKey(), '0');
    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.inflation({}))
      .setTimeout(30)
      .build();
    tx.sign(keypair);
    const xdr = tx.toXDR();

    mockStellarService.submitTransaction.mockResolvedValue({ hash: 'abc123' });

    const result = await controller.submitTransaction(
      xdr,
      mockRequest(keypair.publicKey()) as any,
    );

    expect(result).toEqual({ hash: 'abc123', success: true });
    expect(mockStellarService.submitTransaction).toHaveBeenCalledWith(xdr, {
      allowedOpTypes: [
        'payment',
        'changeTrust',
        'manageSellOffer',
        'manageBuyOffer',
        'pathPaymentStrictSend',
        'pathPaymentStrictReceive',
      ],
    });
  });

  describe('setupPlatformMultiSig (Issue #352)', () => {
    it('should setup multi-sig for admin users', async () => {
      const signer1 = Keypair.random();
      const signer2 = Keypair.random();
      const platformPublicKey = Keypair.random().publicKey();

      mockStellarService.setupPlatformMultiSig.mockResolvedValue({
        platformPublicKey,
        signers: [signer1.publicKey(), signer2.publicKey()],
        transactionThreshold: 2,
      });

      const result = await controller.setupPlatformMultiSig(
        mockRequest(platformPublicKey, 'admin') as any,
      );

      expect(result).toEqual({
        success: true,
        data: {
          platformPublicKey,
          signers: [signer1.publicKey(), signer2.publicKey()],
          transactionThreshold: 2,
        },
      });
      expect(mockStellarService.setupPlatformMultiSig).toHaveBeenCalled();
    });

    it('should throw 403 if user is not admin', async () => {
      const platformPublicKey = Keypair.random().publicKey();

      await expect(
        controller.setupPlatformMultiSig(
          mockRequest(platformPublicKey, 'user') as any,
        ),
      ).rejects.toThrow(
        new HttpException(
          'Only admins can configure platform wallet security',
          HttpStatus.FORBIDDEN,
        ),
      );

      expect(mockStellarService.setupPlatformMultiSig).not.toHaveBeenCalled();
    });

    it('should handle setup errors', async () => {
      const platformPublicKey = Keypair.random().publicKey();

      mockStellarService.setupPlatformMultiSig.mockRejectedValue(
        new Error('Multi-sig setup failed: signers not configured'),
      );

      await expect(
        controller.setupPlatformMultiSig(
          mockRequest(platformPublicKey, 'admin') as any,
        ),
      ).rejects.toThrow(
        new HttpException(
          'Multi-sig setup failed: signers not configured',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });
  });

  describe('getPlatformMultiSigConfig (Issue #352)', () => {
    it('should retrieve multi-sig config for admin users', async () => {
      const signer1 = Keypair.random();
      const signer2 = Keypair.random();
      const platformPublicKey = Keypair.random().publicKey();

      mockStellarService.getPlatformMultiSigConfig.mockResolvedValue({
        publicKey: platformPublicKey,
        signers: [
          { key: platformPublicKey, weight: 1 },
          { key: signer1.publicKey(), weight: 1 },
          { key: signer2.publicKey(), weight: 1 },
        ],
        thresholds: {
          low: 1,
          med: 2,
          high: 2,
        },
      });

      const result = await controller.getPlatformMultiSigConfig(
        mockRequest(platformPublicKey, 'admin') as any,
      );

      expect(result).toEqual({
        success: true,
        data: {
          publicKey: platformPublicKey,
          signers: [
            { key: platformPublicKey, weight: 1 },
            { key: signer1.publicKey(), weight: 1 },
            { key: signer2.publicKey(), weight: 1 },
          ],
          thresholds: {
            low: 1,
            med: 2,
            high: 2,
          },
        },
      });
      expect(mockStellarService.getPlatformMultiSigConfig).toHaveBeenCalled();
    });

    it('should throw 403 if user is not admin', async () => {
      const platformPublicKey = Keypair.random().publicKey();

      await expect(
        controller.getPlatformMultiSigConfig(
          mockRequest(platformPublicKey, 'user') as any,
        ),
      ).rejects.toThrow(
        new HttpException(
          'Only admins can view platform wallet configuration',
          HttpStatus.FORBIDDEN,
        ),
      );

      expect(
        mockStellarService.getPlatformMultiSigConfig,
      ).not.toHaveBeenCalled();
    });

    it('should handle retrieval errors', async () => {
      const platformPublicKey = Keypair.random().publicKey();

      mockStellarService.getPlatformMultiSigConfig.mockRejectedValue(
        new Error('Failed to load account from Horizon'),
      );

      await expect(
        controller.getPlatformMultiSigConfig(
          mockRequest(platformPublicKey, 'admin') as any,
        ),
      ).rejects.toThrow(
        new HttpException(
          'Failed to load account from Horizon',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('should verify 2-of-3 multi-sig configuration', async () => {
      const platformPublicKey = Keypair.random().publicKey();

      mockStellarService.getPlatformMultiSigConfig.mockResolvedValue({
        publicKey: platformPublicKey,
        signers: [
          { key: platformPublicKey, weight: 1 },
          { key: Keypair.random().publicKey(), weight: 1 },
          { key: Keypair.random().publicKey(), weight: 1 },
        ],
        thresholds: {
          low: 1,
          med: 2,
          high: 2,
        },
      });

      const result = await controller.getPlatformMultiSigConfig(
        mockRequest(platformPublicKey, 'admin') as any,
      );

      const config = result.data;
      expect(config.signers).toHaveLength(3);
      expect(config.thresholds.med).toBe(2);
      expect(config.thresholds.high).toBe(2);
    });
  });
});
