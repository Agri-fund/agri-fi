import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StellarMonitorService } from './stellar-monitor.service';
import { Keypair } from '@stellar/stellar-sdk';
import axios from 'axios';

jest.mock('axios');

/**
 * Unit tests for StellarMonitorService (Issue #359)
 * Tests balance monitoring, transaction analysis, and alert triggering
 */
describe('StellarMonitorService', () => {
  let service: StellarMonitorService;
  let mockServer: any;
  let mockConfig: any;

  const mockKeypair = Keypair.random();
  const platformPublicKey = mockKeypair.publicKey();

  beforeEach(async () => {
    mockConfig = {
      get: jest.fn((key: string, defaultVal?: any) => {
        const values: Record<string, any> = {
          STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
          STELLAR_PLATFORM_SECRET: mockKeypair.secret(),
          STELLAR_MONITOR_BALANCE_THRESHOLD: 50,
          ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/TEST/WEBHOOK',
        };
        return values[key] ?? defaultVal ?? '';
      }),
    };

    mockServer = {
      loadAccount: jest.fn(),
      transactions: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarMonitorService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<StellarMonitorService>(StellarMonitorService);
    (service as any).server = mockServer;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Service Initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should load platform account from STELLAR_PLATFORM_SECRET', () => {
      expect((service as any).platformAccountId).toBe(platformPublicKey);
    });

    it('should use default balance threshold of 50 XLM if not configured', () => {
      expect((service as any).BALANCE_THRESHOLD_XLM).toBe(50);
    });

    it('should use custom balance threshold from config', async () => {
      const customConfig = {
        get: jest.fn((key: string, defaultVal?: any) => {
          if (key === 'STELLAR_MONITOR_BALANCE_THRESHOLD') {
            return 100;
          }
          if (key === 'STELLAR_PLATFORM_SECRET') {
            return mockKeypair.secret();
          }
          return defaultVal ?? '';
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StellarMonitorService,
          { provide: ConfigService, useValue: customConfig },
        ],
      }).compile();

      const customService = module.get<StellarMonitorService>(StellarMonitorService);
      expect((customService as any).BALANCE_THRESHOLD_XLM).toBe(100);
    });

    it('should handle invalid STELLAR_PLATFORM_SECRET gracefully', async () => {
      const invalidConfig = {
        get: jest.fn((key: string, defaultVal?: any) => {
          if (key === 'STELLAR_PLATFORM_SECRET') {
            return 'invalid-secret-key';
          }
          return defaultVal ?? '';
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StellarMonitorService,
          { provide: ConfigService, useValue: invalidConfig },
        ],
      }).compile();

      const invalidService = module.get<StellarMonitorService>(StellarMonitorService);
      expect((invalidService as any).platformAccountId).toBeNull();
    });
  });

  describe('checkFeePoolBalance', () => {
    it('should skip check if platform account not configured', async () => {
      (service as any).platformAccountId = null;

      await service.checkFeePoolBalance();

      expect(mockServer.loadAccount).not.toHaveBeenCalled();
    });

    it('should load account and check balance', async () => {
      const mockAccount = {
        balances: [
          { asset_type: 'native', balance: '100.0000000' },
          { asset_type: 'credit_alphanum4', balance: '500.0000000' },
        ],
        sequenceNumber: () => '12345',
        subentry_count: 2,
      };

      mockServer.loadAccount.mockResolvedValue(mockAccount);
      mockServer.transactions.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      await service.checkFeePoolBalance();

      expect(mockServer.loadAccount).toHaveBeenCalledWith(platformPublicKey);
    });

    it('should handle missing native balance', async () => {
      const mockAccount = {
        balances: [
          { asset_type: 'credit_alphanum4', balance: '500.0000000' },
        ],
        sequenceNumber: () => '12345',
        subentry_count: 0,
      };

      mockServer.loadAccount.mockResolvedValue(mockAccount);
      mockServer.transactions.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      await service.checkFeePoolBalance();

      expect(mockServer.loadAccount).toHaveBeenCalled();
    });

    it('should handle Horizon API errors', async () => {
      mockServer.loadAccount.mockRejectedValue(
        new Error('Horizon connection failed'),
      );

      await service.checkFeePoolBalance();

      expect(mockServer.loadAccount).toHaveBeenCalled();
      // Should not throw, just log error
    });
  });

  describe('Transaction Analysis', () => {
    it('should fetch recent transactions', async () => {
      const mockTransactions = [
        {
          fee_charged: '100',
          created_at: '2026-06-28T12:00:00Z',
        },
      ];

      mockServer.transactions.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: mockTransactions }),
      });

      const result = await (service as any).fetchRecentTransactions();

      expect(result).toEqual(mockTransactions);
      expect(mockServer.transactions).toHaveBeenCalled();
    });

    it('should handle transaction fetch failures', async () => {
      mockServer.transactions.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockRejectedValue(new Error('API error')),
      });

      const result = await (service as any).fetchRecentTransactions();

      expect(result).toEqual([]);
    });
  });

  describe('Fee Metrics Analysis', () => {
    it('should return zero metrics for empty transaction list', () => {
      const metrics = (service as any).analyzeFeeMetrics([]);

      expect(metrics).toEqual({
        avgFeeXlm: 0,
        totalFeesXlm: 0,
        projectedMonthlyBurnXlm: 0,
      });
    });

    it('should calculate metrics from transactions', () => {
      const baseTime = new Date('2026-06-20T00:00:00Z').getTime();
      const transactions = Array.from({ length: 10 }, (_, i) => ({
        fee_charged: '100', // 100 stroops = 0.00001 XLM
        created_at: new Date(baseTime + i * 60 * 60 * 1000).toISOString(),
      }));

      const metrics = (service as any).analyzeFeeMetrics(transactions);

      expect(metrics.avgFeeXlm).toBe(0.00001);
      expect(metrics.totalFeesXlm).toBe(0.0001);
      expect(metrics.projectedMonthlyBurnXlm).toBeGreaterThan(0);
    });

    it('should project monthly burn correctly', () => {
      const baseTime = new Date('2026-06-01T00:00:00Z').getTime();
      // 60 transactions over 30 days
      const transactions = Array.from({ length: 60 }, (_, i) => ({
        fee_charged: '100000', // 100000 stroops = 0.01 XLM
        created_at: new Date(baseTime + i * 12 * 60 * 60 * 1000).toISOString(),
      }));

      const metrics = (service as any).analyzeFeeMetrics(transactions);

      // Total: 60 * 0.01 = 0.6 XLM over 30 days
      expect(metrics.projectedMonthlyBurnXlm).toBeCloseTo(0.6, 1);
    });

    it('should handle single transaction', () => {
      const now = new Date().toISOString();
      const transactions = [
        { fee_charged: '100', created_at: now },
      ];

      const metrics = (service as any).analyzeFeeMetrics(transactions);

      expect(metrics.avgFeeXlm).toBe(0.00001);
      expect(metrics.totalFeesXlm).toBe(0.00001);
    });
  });

  describe('Alert Triggering', () => {
    it('should not trigger alert when balance is above threshold', async () => {
      const mockAccount = {
        balances: [{ asset_type: 'native', balance: '100.0000000' }],
        sequenceNumber: () => '12345',
        subentry_count: 0,
      };

      mockServer.loadAccount.mockResolvedValue(mockAccount);
      mockServer.transactions.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      await service.checkFeePoolBalance();

      expect(axios.post).not.toHaveBeenCalled();
    });

    it('should trigger alert when balance falls below threshold', async () => {
      const mockAccount = {
        balances: [{ asset_type: 'native', balance: '25.0000000' }],
        sequenceNumber: () => '12345',
        subentry_count: 0,
      };

      mockServer.loadAccount.mockResolvedValue(mockAccount);
      mockServer.transactions.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      (axios.post as jest.Mock).mockResolvedValue({ status: 200 });

      await service.checkFeePoolBalance();

      expect(axios.post).toHaveBeenCalled();
      const callArgs = (axios.post as jest.Mock).mock.calls[0];
      const payload = callArgs[1];
      expect(payload.text).toContain('25');
      expect(payload.custom_details.currentBalance).toBe(25);
    });

    it('should respect alert cooldown', async () => {
      const mockAccount = {
        balances: [{ asset_type: 'native', balance: '25.0000000' }],
        sequenceNumber: () => '12345',
        subentry_count: 0,
      };

      mockServer.loadAccount.mockResolvedValue(mockAccount);
      mockServer.transactions.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      (axios.post as jest.Mock).mockResolvedValue({ status: 200 });

      // First alert
      await service.checkFeePoolBalance();
      expect(axios.post).toHaveBeenCalledTimes(1);

      // Second alert within cooldown should be suppressed
      await service.checkFeePoolBalance();
      expect(axios.post).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it('should reset alert cooldown when balance is restored', async () => {
      const lowBalanceAccount = {
        balances: [{ asset_type: 'native', balance: '25.0000000' }],
        sequenceNumber: () => '12345',
        subentry_count: 0,
      };

      const healthyBalanceAccount = {
        balances: [{ asset_type: 'native', balance: '100.0000000' }],
        sequenceNumber: () => '12346',
        subentry_count: 0,
      };

      // First check with low balance
      mockServer.loadAccount.mockResolvedValue(lowBalanceAccount);
      mockServer.transactions.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      (axios.post as jest.Mock).mockResolvedValue({ status: 200 });

      await service.checkFeePoolBalance();
      expect(axios.post).toHaveBeenCalledTimes(1);

      // Second check with healthy balance
      mockServer.loadAccount.mockResolvedValue(healthyBalanceAccount);
      await service.checkFeePoolBalance();
      expect((service as any).lastAlertTime).toBe(0);
    });

    it('should handle webhook failure gracefully', async () => {
      const mockAccount = {
        balances: [{ asset_type: 'native', balance: '25.0000000' }],
        sequenceNumber: () => '12345',
        subentry_count: 0,
      };

      mockServer.loadAccount.mockResolvedValue(mockAccount);
      mockServer.transactions.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      (axios.post as jest.Mock).mockRejectedValue(new Error('Webhook failed'));

      // Should not throw
      await service.checkFeePoolBalance();

      expect(axios.post).toHaveBeenCalled();
    });

    it('should log error if webhook URL not configured', async () => {
      const noWebhookConfig = {
        get: jest.fn((key: string, defaultVal?: any) => {
          if (key === 'STELLAR_PLATFORM_SECRET') {
            return mockKeypair.secret();
          }
          if (key === 'STELLAR_MONITOR_BALANCE_THRESHOLD') {
            return 50;
          }
          return defaultVal ?? '';
        }),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StellarMonitorService,
          { provide: ConfigService, useValue: noWebhookConfig },
        ],
      }).compile();

      const noWebhookService = module.get<StellarMonitorService>(StellarMonitorService);
      (noWebhookService as any).server = mockServer;

      const mockAccount = {
        balances: [{ asset_type: 'native', balance: '25.0000000' }],
        sequenceNumber: () => '12345',
        subentry_count: 0,
      };

      mockServer.loadAccount.mockResolvedValue(mockAccount);
      mockServer.transactions.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      // Should not throw
      await noWebhookService.checkFeePoolBalance();
    });
  });

  describe('Alert Payload Formatting', () => {
    it('should include comprehensive metrics in alert payload', async () => {
      const mockAccount = {
        balances: [{ asset_type: 'native', balance: '30.0000000' }],
        sequenceNumber: () => '12345',
        subentry_count: 1,
      };

      mockServer.loadAccount.mockResolvedValue(mockAccount);
      mockServer.transactions.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({
          records: [
            {
              fee_charged: '100000',
              created_at: '2026-06-27T00:00:00Z',
            },
            {
              fee_charged: '100000',
              created_at: '2026-06-28T00:00:00Z',
            },
          ],
        }),
      });

      (axios.post as jest.Mock).mockResolvedValue({ status: 200 });

      await service.checkFeePoolBalance();

      const payload = (axios.post as jest.Mock).mock.calls[0][1];
      expect(payload.custom_details).toEqual({
        currentBalance: 30,
        thresholdXlm: 50,
        accountId: platformPublicKey,
        avgFeeXlm: expect.any(Number),
        projectedMonthlyBurnXlm: expect.any(Number),
        estimatedDaysUntilEmpty: expect.any(Number),
      });
    });

    it('should format Discord embed correctly', async () => {
      const mockAccount = {
        balances: [{ asset_type: 'native', balance: '30.0000000' }],
        sequenceNumber: () => '12345',
        subentry_count: 0,
      };

      mockServer.loadAccount.mockResolvedValue(mockAccount);
      mockServer.transactions.mockReturnValue({
        forAccount: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        call: jest.fn().mockResolvedValue({ records: [] }),
      });

      (axios.post as jest.Mock).mockResolvedValue({ status: 200 });

      await service.checkFeePoolBalance();

      const payload = (axios.post as jest.Mock).mock.calls[0][1];
      expect(payload.embeds).toBeDefined();
      expect(payload.embeds[0].title).toContain('CRITICAL');
      expect(payload.embeds[0].color).toBe(16711680); // Red
      expect(payload.embeds[0].fields).toContainEqual(
        expect.objectContaining({
          name: 'Current Balance',
          value: '30 XLM',
        }),
      );
    });
  });
});
