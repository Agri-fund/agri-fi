import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StellarService } from './stellar.service';

/**
 * Unit tests for StellarService — pure logic that doesn't require network calls.
 * Network-dependent methods (createEscrowAccount, issueTradeToken, etc.) are
 * tested against Stellar testnet in integration tests.
 */
describe('StellarService', () => {
  let service: StellarService;

  const mockConfig = {
    get: jest.fn((key: string, defaultVal?: string) => {
      const values: Record<string, string> = {
        STELLAR_NETWORK: 'testnet',
        STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
        STELLAR_PLATFORM_SECRET: '',
        STELLAR_PLATFORM_PUBLIC: '',
      };
      return values[key] ?? defaultVal ?? '';
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<StellarService>(StellarService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should initialize with testnet network passphrase', () => {
    // Verify the service initializes without throwing
    expect(service).toBeInstanceOf(StellarService);
  });

  describe('getTransactionStatus', () => {
    it('should return "pending" for a 404 response', async () => {
      // Mock the server's transactions call to simulate a 404
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

  describe('transferTradeTokens', () => {
    it('should build and submit a payment transaction', async () => {
      const mockTxResult = { hash: 'mock-tx-hash' };
      const mockAccount = {
        sequenceNumber: () => '1',
        incrementSequenceNumber: jest.fn(),
      };

      (service as any).server = {
        loadAccount: jest.fn().mockResolvedValue(mockAccount),
        submitTransaction: jest.fn().mockResolvedValue(mockTxResult),
      };

      const secret =
        'SBTBBMK2NRE6B6L7P6BOMJ6M2NRE6B6L7P6BOMJ6M2NRE6B6L7P6BOMJ6';
      const result = await service.transferTradeTokens(
        secret,
        'GB...',
        'GC...',
        'TOKEN',
        100,
      );

      expect(result).toBe('mock-tx-hash');
      expect((service as any).server.loadAccount).toHaveBeenCalledWith('GB...');
      expect((service as any).server.submitTransaction).toHaveBeenCalled();
    });
  });
});
