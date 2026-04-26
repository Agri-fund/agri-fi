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
  Asset,
  Account,
} from 'stellar-sdk';

const mockStellarService = {
  submitTransaction: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key: string, defaultVal?: string) => {
    const values: Record<string, string> = {
      STELLAR_NETWORK: 'testnet',
    };
    return values[key] ?? defaultVal ?? '';
  }),
};

const mockRequest = (walletAddress: string | null) => ({
  user: { walletAddress },
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
      controller.submitTransaction('not-valid-xdr', mockRequest('GXXXXXX') as any),
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
    expect(mockStellarService.submitTransaction).toHaveBeenCalledWith(xdr);
  });
});
