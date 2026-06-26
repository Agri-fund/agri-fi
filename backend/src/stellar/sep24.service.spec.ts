import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { Sep24Service } from './sep24.service';
import {
  Sep24Transaction,
  Sep24TxKind,
  Sep24TxStatus,
} from './entities/sep24-transaction.entity';

const STELLAR_ACCOUNT = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGWKX2ZVBFGCNX5J3MHAQX';

describe('Sep24Service', () => {
  let service: Sep24Service;
  let txRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
  };

  const configValues: Record<string, string | number> = {
    USDC_ISSUER: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    USDC_ASSET_CODE: 'USDC',
    SEP24_INTERACTIVE_BASE_URL: 'http://localhost:3000/sep24/interactive',
    SEP24_FEE_PERCENT: 1,
    SEP24_FEE_FIXED: 0,
    SEP24_MIN_AMOUNT: 10,
    SEP24_MAX_AMOUNT: 100_000,
  };

  const configService = {
    get: jest.fn((key: string, defaultValue?: string | number) => {
      return configValues[key] ?? defaultValue;
    }),
  };

  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(async () => {
    txRepo = {
      create: jest.fn((data) => ({ ...data })),
      save: jest.fn(async (data) => data),
      findOne: jest.fn(),
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Sep24Service,
        { provide: getRepositoryToken(Sep24Transaction), useValue: txRepo },
        { provide: ConfigService, useValue: configService },
        { provide: PinoLogger, useValue: logger },
      ],
    }).compile();

    service = module.get(Sep24Service);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getInfo', () => {
    it('returns deposit and withdraw info for USDC', () => {
      const info = service.getInfo();
      expect(info.deposit.USDC).toBeDefined();
      expect(info.withdraw.USDC).toBeDefined();
      expect(info.deposit.USDC.enabled).toBe(true);
      expect(info.fee.enabled).toBe(true);
    });
  });

  describe('initiateDepositInteractive', () => {
    it('creates a deposit transaction and returns interactive URL', async () => {
      const result = await service.initiateDepositInteractive(
        {
          asset_code: 'USDC',
          account: STELLAR_ACCOUNT,
          amount: '100',
        },
        'user-1',
      );

      expect(result.type).toBe('interactive_customer_info_needed');
      expect(result.id).toBeDefined();
      expect(result.url).toContain('transaction_id=');
      expect(result.url).toContain('kind=deposit');
      expect(txRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: Sep24TxKind.DEPOSIT,
          status: Sep24TxStatus.PENDING_ANCHOR,
          stellarAccount: STELLAR_ACCOUNT,
        }),
      );
    });

    it('rejects unsupported asset codes', async () => {
      await expect(
        service.initiateDepositInteractive(
          { asset_code: 'XLM', account: STELLAR_ACCOUNT },
          null,
        ),
      ).rejects.toThrow('Unsupported asset_code');
    });

    it('rejects amounts below minimum', async () => {
      await expect(
        service.initiateDepositInteractive(
          { asset_code: 'USDC', account: STELLAR_ACCOUNT, amount: '5' },
          null,
        ),
      ).rejects.toThrow('amount must be between');
    });
  });

  describe('initiateWithdrawInteractive', () => {
    it('creates a withdrawal transaction with destination info', async () => {
      const result = await service.initiateWithdrawInteractive(
        {
          asset_code: 'USDC',
          account: STELLAR_ACCOUNT,
          amount: '50',
          dest: '0123456789',
          dest_extra: '058',
        },
        'user-1',
      );

      expect(result.type).toBe('interactive_customer_info_needed');
      expect(result.url).toContain('kind=withdraw');
      expect(txRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: Sep24TxKind.WITHDRAW,
          dest: '0123456789',
          destExtra: '058',
        }),
      );
    });
  });

  describe('getTransaction', () => {
    it('returns transaction for the owning account', async () => {
      const tx: Sep24Transaction = {
        id: 'abc123',
        stellarAccount: STELLAR_ACCOUNT,
        userId: 'user-1',
        kind: Sep24TxKind.DEPOSIT,
        assetCode: 'USDC',
        amountIn: '100',
        amountOut: null,
        status: Sep24TxStatus.PENDING_ANCHOR,
        message: null,
        dest: null,
        destExtra: null,
        externalTxId: null,
        stellarTransactionId: null,
        startedAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      };
      txRepo.findOne!.mockResolvedValue(tx);

      const result = await service.getTransaction('abc123', STELLAR_ACCOUNT);
      expect(result.transaction.id).toBe('abc123');
      expect(result.transaction.amount_in).toBe('100');
    });

    it('rejects access from a different account', async () => {
      txRepo.findOne!.mockResolvedValue({
        id: 'abc123',
        stellarAccount: STELLAR_ACCOUNT,
      } as Sep24Transaction);

      await expect(
        service.getTransaction('abc123', 'GOTHERACCOUNT123456789012345678901234'),
      ).rejects.toThrow('does not belong');
    });
  });

  describe('handleStatusCallback', () => {
    it('updates transaction status from webhook payload', async () => {
      const tx: Sep24Transaction = {
        id: 'abc123',
        stellarAccount: STELLAR_ACCOUNT,
        userId: null,
        kind: Sep24TxKind.DEPOSIT,
        assetCode: 'USDC',
        amountIn: '100',
        amountOut: null,
        status: Sep24TxStatus.PENDING_ANCHOR,
        message: null,
        dest: null,
        destExtra: null,
        externalTxId: null,
        stellarTransactionId: null,
        startedAt: new Date(),
        updatedAt: new Date(),
      };
      txRepo.findOne!.mockResolvedValue(tx);

      await service.handleStatusCallback({
        transaction_id: 'abc123',
        status: Sep24TxStatus.COMPLETED,
        amount_out: '99',
        stellar_transaction_id: 'stellar-tx-hash',
        external_transaction_id: 'bank-ref-001',
        message: 'Deposit completed',
      });

      expect(txRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: Sep24TxStatus.COMPLETED,
          amountOut: '99',
          stellarTransactionId: 'stellar-tx-hash',
          externalTxId: 'bank-ref-001',
        }),
      );
    });

    it('ignores callbacks for terminal transactions', async () => {
      txRepo.findOne!.mockResolvedValue({
        id: 'abc123',
        status: Sep24TxStatus.COMPLETED,
      } as Sep24Transaction);

      await service.handleStatusCallback({
        transaction_id: 'abc123',
        status: Sep24TxStatus.PENDING_STELLAR,
      });

      expect(txRepo.save).not.toHaveBeenCalled();
    });

    it('throws when transaction is not found', async () => {
      txRepo.findOne!.mockResolvedValue(null);

      await expect(
        service.handleStatusCallback({
          transaction_id: 'missing',
          status: Sep24TxStatus.COMPLETED,
        }),
      ).rejects.toThrow('not found');
    });
  });

  describe('assertAccountMatchesWallet', () => {
    it('throws when wallet is not linked', () => {
      expect(() =>
        service.assertAccountMatchesWallet(STELLAR_ACCOUNT, null),
      ).toThrow('No wallet address linked');
    });

    it('throws when account does not match wallet', () => {
      expect(() =>
        service.assertAccountMatchesWallet(
          STELLAR_ACCOUNT,
          'GOTHERACCOUNT123456789012345678901234',
        ),
      ).toThrow('must match');
    });
  });
});
