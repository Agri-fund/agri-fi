/**
 * Integration tests for StellarMonitorService payment-streaming functionality.
 * Issue #905 — Stellar payment streaming & reconciliation
 *
 * All Horizon network calls and external dependencies are mocked.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StellarMonitorService } from './stellar-monitor.service';
import { StellarService } from './stellar.service';
import { InvestmentsService } from '../investments/investments.service';
import { AccountMergeRecovery } from './entities/account-merge-recovery.entity';
import { UnrecognisedPayment } from './entities/unrecognised-payment.entity';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Builds a minimal valid payment record as returned by Horizon. */
function makePayment(overrides: Partial<Record<string, any>> = {}): any {
  return {
    id: 'payment-id-001',
    paging_token: '12345',
    transaction_hash: 'abcdef1234567890'.repeat(4),
    type: 'payment',
    from: 'GABC1234',
    amount: '500.0000000',
    asset_code: 'USDC',
    asset_issuer: 'GCENTER',
    memo: null,
    ...overrides,
  };
}

/** Generates a unique-looking 64-char hex hash. */
let hashCounter = 0;
function uniqueHash(): string {
  const base = (++hashCounter).toString(16).padStart(4, '0');
  return base.repeat(16).slice(0, 64);
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockStreamClose = jest.fn();

/** Captures the callbacks passed to .stream() so tests can trigger them. */
let capturedStreamCallbacks: {
  onmessage?: (p: any) => void;
  onerror?: (e: any) => void;
} = {};

const mockPaymentsForAccount = {
  stream: jest.fn((callbacks: any) => {
    capturedStreamCallbacks = callbacks;
    return mockStreamClose;
  }),
  order: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  call: jest.fn().mockResolvedValue({ records: [] }),
};

const mockPaymentsBuilder = {
  forAccount: jest.fn().mockReturnValue(mockPaymentsForAccount),
};

const mockTransactionsBuilder = {
  transaction: jest.fn().mockReturnValue({
    call: jest.fn().mockResolvedValue({ memo: null }),
  }),
  forAccount: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  call: jest.fn().mockResolvedValue({ records: [] }),
};

const mockHorizonServer = {
  payments: jest.fn().mockReturnValue(mockPaymentsBuilder),
  transactions: jest.fn().mockReturnValue(mockTransactionsBuilder),
  loadAccount: jest.fn().mockResolvedValue({
    balances: [{ asset_type: 'native', balance: '100.0000000' }],
    sequenceNumber: () => '12345',
    subentry_count: 0,
  }),
};

// Patch the Horizon.Server constructor before importing the service module.
jest.mock('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: jest.fn().mockImplementation(() => mockHorizonServer),
  },
  Keypair: {
    fromSecret: jest.fn().mockReturnValue({
      publicKey: () => 'GPLATFORM_ACCOUNT_ID',
    }),
  },
}));

jest.mock('axios');

// ── Test suite ────────────────────────────────────────────────────────────────

describe('StellarMonitorService — payment streaming (Issue #905)', () => {
  let service: StellarMonitorService;
  let unrecognisedPaymentRepo: jest.Mocked<Repository<UnrecognisedPayment>>;
  let investmentsService: jest.Mocked<
    Pick<InvestmentsService, 'confirmPaymentFromStream'>
  >;
  let paymentsReceivedCounter: { inc: jest.Mock };
  let paymentsUnmatchedCounter: { inc: jest.Mock };

  beforeEach(async () => {
    capturedStreamCallbacks = {};
    jest.clearAllMocks();

    // Reset mock return values that carry state
    mockPaymentsForAccount.stream.mockImplementation((callbacks: any) => {
      capturedStreamCallbacks = callbacks;
      return mockStreamClose;
    });
    mockPaymentsForAccount.call.mockResolvedValue({ records: [] });

    paymentsReceivedCounter = { inc: jest.fn() };
    paymentsUnmatchedCounter = { inc: jest.fn() };

    const mockUnrecognisedRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((data: any) => data),
      save: jest.fn().mockImplementation(async (entity: any) => entity),
      find: jest.fn().mockResolvedValue([]),
    };

    const mockMergeRecoveryRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((data: any) => data),
      save: jest.fn().mockImplementation(async (entity: any) => entity),
    };

    const mockInvestmentsService = {
      confirmPaymentFromStream: jest.fn().mockResolvedValue(undefined),
    };

    const mockStellarService = {
      createReplacementAccount: jest.fn(),
      encryptSecret: jest.fn(),
      checkUsdcTrustline: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarMonitorService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultVal?: any) => {
              const cfg: Record<string, any> = {
                STELLAR_HORIZON_URL:
                  'https://horizon-testnet.stellar.org',
                STELLAR_PLATFORM_SECRET:
                  'SPLATFORM_SECRET_FOR_TESTING_ONLY',
                STELLAR_MONITOR_BALANCE_THRESHOLD: 50,
                ALERT_WEBHOOK_URL: 'https://example.com/webhook',
              };
              return cfg[key] ?? defaultVal;
            }),
          },
        },
        {
          provide: getRepositoryToken(UnrecognisedPayment),
          useValue: mockUnrecognisedRepo,
        },
        {
          provide: getRepositoryToken(AccountMergeRecovery),
          useValue: mockMergeRecoveryRepo,
        },
        { provide: StellarService, useValue: mockStellarService },
        { provide: InvestmentsService, useValue: mockInvestmentsService },
        {
          provide: 'PROM_METRIC_STELLAR_PAYMENTS_RECEIVED_TOTAL',
          useValue: paymentsReceivedCounter,
        },
        {
          provide: 'PROM_METRIC_STELLAR_PAYMENTS_UNMATCHED_TOTAL',
          useValue: paymentsUnmatchedCounter,
        },
      ],
    }).compile();

    service = module.get(StellarMonitorService);
    unrecognisedPaymentRepo = module.get(
      getRepositoryToken(UnrecognisedPayment),
    ) as any;
    investmentsService = module.get(InvestmentsService) as any;
  });

  // ── 1. Stream established on init ───────────────────────────────────────────

  describe('onModuleInit', () => {
    it('establishes a Horizon payment stream for the platform account', async () => {
      await service.onModuleInit();

      expect(mockHorizonServer.payments).toHaveBeenCalled();
      expect(mockPaymentsBuilder.forAccount).toHaveBeenCalledWith(
        'GPLATFORM_ACCOUNT_ID',
      );
      expect(mockPaymentsForAccount.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          onmessage: expect.any(Function),
          onerror: expect.any(Function),
        }),
      );
    });

    it('does not start stream when STELLAR_PLATFORM_SECRET is not configured', async () => {
      // Build a service variant with no platform secret
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StellarMonitorService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string, defaultVal?: any) => {
                if (key === 'STELLAR_PLATFORM_SECRET') return '';
                const cfg: Record<string, any> = {
                  STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
                  STELLAR_MONITOR_BALANCE_THRESHOLD: 50,
                };
                return cfg[key] ?? defaultVal;
              }),
            },
          },
          {
            provide: getRepositoryToken(UnrecognisedPayment),
            useValue: { findOne: jest.fn(), create: jest.fn(), save: jest.fn() },
          },
          {
            provide: getRepositoryToken(AccountMergeRecovery),
            useValue: { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), create: jest.fn(), save: jest.fn() },
          },
          { provide: StellarService, useValue: {} },
          { provide: InvestmentsService, useValue: {} },
          {
            provide: 'PROM_METRIC_STELLAR_PAYMENTS_RECEIVED_TOTAL',
            useValue: { inc: jest.fn() },
          },
          {
            provide: 'PROM_METRIC_STELLAR_PAYMENTS_UNMATCHED_TOTAL',
            useValue: { inc: jest.fn() },
          },
        ],
      }).compile();

      const noSecretService = module.get(StellarMonitorService);
      const streamSpy = jest.spyOn(mockPaymentsForAccount, 'stream');
      streamSpy.mockClear();

      noSecretService.onModuleInit();

      // Give any async ticks a chance to run.
      await new Promise((r) => setImmediate(r));

      expect(streamSpy).not.toHaveBeenCalled();
    });
  });

  // ── 2. handleIncomingPayment: matched memo ──────────────────────────────────

  describe('handleIncomingPayment — matched memo', () => {
    it('parses DEAL-{dealId}-INV-{investmentId} memo and calls confirmPaymentFromStream', async () => {
      const investmentId = 'inv-uuid-9999';
      const dealId = 'deal-uuid-1234';
      const txHash = uniqueHash();

      const payment = makePayment({
        transaction_hash: txHash,
        memo: `DEAL-${dealId}-INV-${investmentId}`,
        amount: '1000.0000000',
      });

      await service.handleIncomingPayment(payment);

      expect(investmentsService.confirmPaymentFromStream).toHaveBeenCalledWith(
        investmentId,
        txHash,
        '1000.0000000',
      );
      expect(unrecognisedPaymentRepo.save).not.toHaveBeenCalled();
    });

    it('increments paymentsReceivedCounter with the asset label', async () => {
      const txHash = uniqueHash();
      const payment = makePayment({
        transaction_hash: txHash,
        asset_code: 'USDC',
        memo: 'DEAL-deal-001-INV-inv-001',
      });

      await service.handleIncomingPayment(payment);

      expect(paymentsReceivedCounter.inc).toHaveBeenCalledWith({ asset: 'USDC' });
    });

    it('uses "XLM" as the asset label when asset_code is absent (native payment)', async () => {
      const txHash = uniqueHash();
      const payment = makePayment({
        transaction_hash: txHash,
        asset_code: undefined,
        memo: 'DEAL-d1-INV-i1',
      });

      await service.handleIncomingPayment(payment);

      expect(paymentsReceivedCounter.inc).toHaveBeenCalledWith({ asset: 'XLM' });
    });

    it('fetches the transaction from Horizon when memo is not inline', async () => {
      const txHash = uniqueHash();
      const investmentId = 'inv-fetched-memo';
      const dealId = 'deal-fetched';

      mockTransactionsBuilder.transaction.mockReturnValue({
        call: jest.fn().mockResolvedValue({
          memo: `DEAL-${dealId}-INV-${investmentId}`,
        }),
      });

      const payment = makePayment({
        transaction_hash: txHash,
        memo: null, // no inline memo
      });

      await service.handleIncomingPayment(payment);

      expect(mockHorizonServer.transactions).toHaveBeenCalled();
      expect(investmentsService.confirmPaymentFromStream).toHaveBeenCalledWith(
        investmentId,
        txHash,
        expect.any(String),
      );
    });
  });

  // ── 3. Duplicate payment dedup ─────────────────────────────────────────────

  describe('handleIncomingPayment — deduplication', () => {
    it('skips the second call for the same txHash (in-memory cache)', async () => {
      const txHash = uniqueHash();
      const payment = makePayment({
        transaction_hash: txHash,
        memo: 'DEAL-d-INV-i',
      });

      await service.handleIncomingPayment(payment);
      await service.handleIncomingPayment(payment);

      // confirmPaymentFromStream should only be called once.
      expect(
        investmentsService.confirmPaymentFromStream,
      ).toHaveBeenCalledTimes(1);
      expect(paymentsReceivedCounter.inc).toHaveBeenCalledTimes(1);
    });

    it('skips processing when the payment already exists in unrecognised_payments (DB dedup)', async () => {
      const txHash = uniqueHash();

      // Simulate the record already being in the DB.
      (unrecognisedPaymentRepo.findOne as jest.Mock).mockResolvedValueOnce({
        id: 'existing-id',
        stellarTxHash: txHash,
      });

      const payment = makePayment({ transaction_hash: txHash });

      await service.handleIncomingPayment(payment);

      expect(paymentsReceivedCounter.inc).not.toHaveBeenCalled();
      expect(
        investmentsService.confirmPaymentFromStream,
      ).not.toHaveBeenCalled();
    });
  });

  // ── 4. Unmatched payment → unrecognised_payments ────────────────────────────

  describe('handleIncomingPayment — unmatched payment', () => {
    it('saves to unrecognised_payments table and increments unmatched counter', async () => {
      const txHash = uniqueHash();
      const payment = makePayment({
        transaction_hash: txHash,
        memo: 'RANDOM_MEMO_NO_MATCH',
        from: 'GSTRANGER123',
        amount: '250.0000000',
      });

      await service.handleIncomingPayment(payment);

      expect(unrecognisedPaymentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          stellarTxHash: txHash,
          fromAccount: 'GSTRANGER123',
          memo: 'RANDOM_MEMO_NO_MATCH',
        }),
      );
      expect(unrecognisedPaymentRepo.save).toHaveBeenCalled();
      expect(paymentsUnmatchedCounter.inc).toHaveBeenCalled();
    });

    it('saves to unrecognised_payments when memo is null', async () => {
      const txHash = uniqueHash();
      const payment = makePayment({ transaction_hash: txHash, memo: null });

      // Mock transaction fetch returning no memo either
      mockTransactionsBuilder.transaction.mockReturnValue({
        call: jest.fn().mockResolvedValue({ memo: null }),
      });

      await service.handleIncomingPayment(payment);

      expect(unrecognisedPaymentRepo.save).toHaveBeenCalled();
      expect(paymentsUnmatchedCounter.inc).toHaveBeenCalled();
    });

    it('does not throw when DB save fails with a unique-constraint violation', async () => {
      const txHash = uniqueHash();
      const payment = makePayment({
        transaction_hash: txHash,
        memo: 'NO_MATCH',
      });

      const uniqueError: any = new Error('duplicate key value');
      uniqueError.code = '23505';
      (unrecognisedPaymentRepo.save as jest.Mock).mockRejectedValueOnce(
        uniqueError,
      );

      await expect(service.handleIncomingPayment(payment)).resolves.not.toThrow();
    });
  });

  // ── 5. Stream reconnection with exponential backoff ─────────────────────────

  describe('scheduleReconnect', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('retries startPaymentStream with exponential backoff', async () => {
      await service.onModuleInit(); // open stream

      // Simulate stream errors triggering reconnects
      const streamSpy = jest
        .spyOn(service as any, 'startPaymentStream')
        .mockResolvedValue(undefined);

      // First error
      capturedStreamCallbacks.onerror?.(new Error('stream error'));
      expect(streamSpy).not.toHaveBeenCalled(); // not yet — setTimeout pending

      // Advance 1000 ms (BASE * 2^0 = 1000)
      jest.advanceTimersByTime(1000);
      await Promise.resolve(); // flush microtasks
      expect(streamSpy).toHaveBeenCalledTimes(1);

      // Second reconnect attempt — delay should be 2000 ms
      capturedStreamCallbacks.onerror?.(new Error('stream error again'));
      jest.advanceTimersByTime(1999);
      await Promise.resolve();
      expect(streamSpy).toHaveBeenCalledTimes(1); // not yet

      jest.advanceTimersByTime(1);
      await Promise.resolve();
      expect(streamSpy).toHaveBeenCalledTimes(2);
    });

    it('caps reconnect delay at 5 minutes', () => {
      // Force a high attempt count
      (service as any).streamReconnectAttempts = 20;
      (service as any).platformAccountId = 'GPLATFORM_ACCOUNT_ID';
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      // Manually call scheduleReconnect with a lower attempt count than MAX
      // so the branch that caps is hit.
      (service as any).streamReconnectAttempts = 10;
      (service as any).scheduleReconnect();

      // delay = min(1000 * 2^10, 300_000) = min(1_024_000, 300_000) = 300_000
      expect(setTimeoutSpy).toHaveBeenCalledWith(
        expect.any(Function),
        300_000,
      );
    });

    it('sends a critical alert and stops reconnecting after MAX_RECONNECT_ATTEMPTS', async () => {
      (service as any).streamReconnectAttempts = 20; // at limit
      const sendAlertSpy = jest
        .spyOn(service as any, 'sendAlert')
        .mockResolvedValue(undefined);
      const startStreamSpy = jest.spyOn(service as any, 'startPaymentStream');

      (service as any).scheduleReconnect();

      expect(sendAlertSpy).toHaveBeenCalled();
      expect(startStreamSpy).not.toHaveBeenCalled();
    });
  });

  // ── 6. pollMissedPayments ──────────────────────────────────────────────────

  describe('pollMissedPayments', () => {
    it('calls handleIncomingPayment for each recent payment not in dedup cache', async () => {
      const hash1 = uniqueHash();
      const hash2 = uniqueHash();

      mockPaymentsForAccount.call.mockResolvedValueOnce({
        records: [
          makePayment({ transaction_hash: hash1 }),
          makePayment({ transaction_hash: hash2 }),
        ],
      });

      const handleSpy = jest
        .spyOn(service as any, 'handleIncomingPayment')
        .mockResolvedValue(undefined);

      await service.pollMissedPayments();

      expect(handleSpy).toHaveBeenCalledTimes(2);
      expect(handleSpy).toHaveBeenCalledWith(
        expect.objectContaining({ transaction_hash: hash1 }),
      );
      expect(handleSpy).toHaveBeenCalledWith(
        expect.objectContaining({ transaction_hash: hash2 }),
      );
    });

    it('skips payments that are already in the in-memory dedup cache', async () => {
      const cachedHash = uniqueHash();
      const freshHash = uniqueHash();

      // Pre-populate the cache
      (service as any).processedTxHashes.add(cachedHash);

      mockPaymentsForAccount.call.mockResolvedValueOnce({
        records: [
          makePayment({ transaction_hash: cachedHash }),
          makePayment({ transaction_hash: freshHash }),
        ],
      });

      const handleSpy = jest
        .spyOn(service as any, 'handleIncomingPayment')
        .mockResolvedValue(undefined);

      await service.pollMissedPayments();

      // Only the fresh payment should be processed
      expect(handleSpy).toHaveBeenCalledTimes(1);
      expect(handleSpy).toHaveBeenCalledWith(
        expect.objectContaining({ transaction_hash: freshHash }),
      );
    });

    it('does nothing when platformAccountId is not configured', async () => {
      (service as any).platformAccountId = null;
      const handleSpy = jest.spyOn(service as any, 'handleIncomingPayment');

      await service.pollMissedPayments();

      expect(mockPaymentsForAccount.call).not.toHaveBeenCalled();
      expect(handleSpy).not.toHaveBeenCalled();
    });
  });

  // ── 7. onModuleDestroy ─────────────────────────────────────────────────────

  describe('onModuleDestroy', () => {
    it('closes the payment stream on destroy', async () => {
      await service.onModuleInit(); // opens stream, sets this.paymentStream

      service.onModuleDestroy();

      expect(mockStreamClose).toHaveBeenCalled();
    });
  });
});
