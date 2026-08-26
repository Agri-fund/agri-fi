import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Horizon } from '@stellar/stellar-sdk';
import axios from 'axios';
import { StellarMonitorService } from './stellar-monitor.service';
import { StellarService } from './stellar.service';
import { AccountMergeRecovery } from './entities/account-merge-recovery.entity';

jest.mock('axios');
jest.mock('@stellar/stellar-sdk');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('StellarMonitorService - Account Merge Recovery', () => {
  let service: StellarMonitorService;
  let mergeRecoveryRepo: jest.Mocked<Repository<AccountMergeRecovery>>;
  let stellarService: jest.Mocked<StellarService>;
  let configService: ConfigService;

  const mockOriginalKey =
    'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37';
  const mockMergedKey =
    'GBQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W38';
  const mockReplacementKey =
    'GCRP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W39';

  beforeEach(async () => {
    mergeRecoveryRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    } as any;

    stellarService = {
      createReplacementAccount: jest.fn(),
      encryptSecret: jest.fn(),
    } as any;

    configService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
          STELLAR_MONITOR_BALANCE_THRESHOLD: 50,
          USDC_ISSUER:
            'GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQA4LOV3GVNQG4PMLV7EWWHZ',
          ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/test',
        };
        return config[key] ?? defaultValue;
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StellarMonitorService,
        {
          provide: ConfigService,
          useValue: configService,
        },
        {
          provide: getRepositoryToken(AccountMergeRecovery),
          useValue: mergeRecoveryRepo,
        },
        {
          provide: StellarService,
          useValue: stellarService,
        },
      ],
    }).compile();

    service = module.get<StellarMonitorService>(StellarMonitorService);
  });

  describe('processAccountMergeTx', () => {
    it('should create merge recovery record when detecting account merge operation', async () => {
      const mockTx = {
        id: 'abc123def456',
        source_account: mockOriginalKey,
        operations: [
          {
            type: 'account_merge',
            source_account: mockOriginalKey,
            into: mockMergedKey,
          },
        ],
      };

      (mergeRecoveryRepo.findOne as jest.Mock).mockResolvedValueOnce(null);

      const mockRecord = {
        id: 'recovery-123',
        originalPublicKey: mockOriginalKey,
        mergedPublicKey: mockMergedKey,
        status: 'detected',
        detectedInTxHash: mockTx.id,
      };

      (mergeRecoveryRepo.create as jest.Mock).mockReturnValueOnce(mockRecord);
      (mergeRecoveryRepo.save as jest.Mock).mockResolvedValueOnce(mockRecord);

      await (service as any).processAccountMergeTx(mockTx);

      expect(mergeRecoveryRepo.findOne).toHaveBeenCalledWith({
        where: {
          originalPublicKey: mockOriginalKey,
          mergedPublicKey: mockMergedKey,
        },
      });

      expect(mergeRecoveryRepo.create).toHaveBeenCalledWith({
        originalPublicKey: mockOriginalKey,
        mergedPublicKey: mockMergedKey,
        status: 'detected',
        detectedInTxHash: mockTx.id,
      });

      expect(mergeRecoveryRepo.save).toHaveBeenCalledWith(mockRecord);
    });

    it('should skip already-tracked merges', async () => {
      const mockTx = {
        id: 'abc123def456',
        source_account: mockOriginalKey,
        operations: [
          {
            type: 'account_merge',
            source_account: mockOriginalKey,
            into: mockMergedKey,
          },
        ],
      };

      const existingRecord = {
        id: 'recovery-existing',
        originalPublicKey: mockOriginalKey,
        mergedPublicKey: mockMergedKey,
        status: 'detected',
      };

      (mergeRecoveryRepo.findOne as jest.Mock).mockResolvedValueOnce(
        existingRecord,
      );

      await (service as any).processAccountMergeTx(mockTx);

      expect(mergeRecoveryRepo.create).not.toHaveBeenCalled();
      expect(mergeRecoveryRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('attemptMergeRecovery', () => {
    it('should create replacement account when status is detected', async () => {
      const recovery = {
        id: 'recovery-123',
        originalPublicKey: mockOriginalKey,
        mergedPublicKey: mockMergedKey,
        replacementPublicKey: null,
        replacementSecretKeyEncrypted: null,
        status: 'detected' as const,
        paymentRetryAttempts: 0,
        lastErrorMessage: null,
      };

      (
        stellarService.createReplacementAccount as jest.Mock
      ).mockResolvedValueOnce({
        publicKey: mockReplacementKey,
        secretKey: 'SBABCDEF123456',
      });

      (stellarService.encryptSecret as jest.Mock).mockReturnValueOnce(
        'encrypted-secret',
      );

      // Mock Horizon server to verify trustline
      const mockServer = {
        loadAccount: jest.fn().mockResolvedValueOnce({
          balances: [
            {
              asset_type: 'native',
              balance: '3.0',
            },
            {
              asset_code: 'USDC',
              asset_issuer:
                'GBUQWP3BOUZX34ULNQG23RQ6F4YUSXHTQA4LOV3GVNQG4PMLV7EWWHZ',
              balance: '0',
            },
          ],
        }),
      };

      (service as any).server = mockServer;

      (mergeRecoveryRepo.save as jest.Mock).mockResolvedValueOnce({
        ...recovery,
        replacementPublicKey: mockReplacementKey,
        replacementSecretKeyEncrypted: 'encrypted-secret',
        status: 'trustline_established',
      });

      await (service as any).attemptMergeRecovery(recovery);

      expect(stellarService.createReplacementAccount).toHaveBeenCalled();
      expect(stellarService.encryptSecret).toHaveBeenCalledWith(
        'SBABCDEF123456',
      );
      expect(mergeRecoveryRepo.save).toHaveBeenCalled();
    });

    it('should mark recovery as failed after 3 retry attempts', async () => {
      const recovery = {
        id: 'recovery-123',
        originalPublicKey: mockOriginalKey,
        mergedPublicKey: mockMergedKey,
        replacementPublicKey: null,
        status: 'detected' as const,
        paymentRetryAttempts: 2,
        lastErrorMessage: 'Previous error',
      };

      const testError = new Error('Account creation failed');

      (
        stellarService.createReplacementAccount as jest.Mock
      ).mockRejectedValueOnce(testError);

      (mergeRecoveryRepo.save as jest.Mock).mockResolvedValueOnce({
        ...recovery,
        status: 'failed',
        paymentRetryAttempts: 3,
        lastErrorMessage: 'Account creation failed',
      });

      mockedAxios.post.mockResolvedValueOnce({ status: 200 });

      await (service as any).attemptMergeRecovery(recovery);

      expect(mergeRecoveryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          paymentRetryAttempts: 3,
          lastErrorMessage: 'Account creation failed',
        }),
      );

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/test',
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              title: '🚨 Account Merge Recovery Failed',
            }),
          ]),
        }),
      );
    });

    it('should retry on transient errors without marking as failed', async () => {
      const recovery = {
        id: 'recovery-123',
        originalPublicKey: mockOriginalKey,
        mergedPublicKey: mockMergedKey,
        replacementPublicKey: null,
        status: 'detected' as const,
        paymentRetryAttempts: 0,
        lastErrorMessage: null,
      };

      const transientError = new Error('Horizon timeout');

      (
        stellarService.createReplacementAccount as jest.Mock
      ).mockRejectedValueOnce(transientError);

      (mergeRecoveryRepo.save as jest.Mock).mockResolvedValueOnce({
        ...recovery,
        paymentRetryAttempts: 1,
        lastErrorMessage: 'Horizon timeout',
      });

      await (service as any).attemptMergeRecovery(recovery);

      expect(mergeRecoveryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentRetryAttempts: 1,
        }),
      );

      expect(mockedAxios.post).not.toHaveBeenCalled(); // No alert yet
    });
  });

  describe('releaseEscrowWithMergeRecovery', () => {
    it('should succeed on first attempt if no op_no_trust error', async () => {
      const mockStellarService = {
        releaseEscrow: jest.fn().mockResolvedValueOnce(['tx-hash-123']),
        releaseEscrowWithMergeRecovery: jest.fn(),
      } as any;

      (service as any).stellarService = mockStellarService;

      const investorShares = [
        { walletAddress: 'INVESTOR1', tokenAmount: 100, totalTokens: 100 },
      ];

      const result = await (service as any).releaseEscrowWithMergeRecovery(
        'ESCROW_SECRET',
        'FARMER_WALLET',
        investorShares,
        'PLATFORM_WALLET',
        1000,
        'deal-123',
      );

      expect(result).toEqual(['tx-hash-123']);
    });

    it('should retry on op_no_trust error up to 3 times', async () => {
      const opNoTrustError = {
        response: {
          data: {
            extras: {
              result_codes: {
                operations: ['op_no_trust'],
              },
            },
          },
        },
        message: 'op_no_trust',
      };

      const mockStellarService = {
        releaseEscrow: jest
          .fn()
          .mockRejectedValueOnce(opNoTrustError)
          .mockRejectedValueOnce(opNoTrustError)
          .mockResolvedValueOnce(['tx-hash-123']),
      } as any;

      (service as any).stellarService = mockStellarService;

      const investorShares = [
        { walletAddress: 'INVESTOR1', tokenAmount: 100, totalTokens: 100 },
      ];

      const result = await (service as any).releaseEscrowWithMergeRecovery(
        'ESCROW_SECRET',
        'FARMER_WALLET',
        investorShares,
        'PLATFORM_WALLET',
        1000,
        'deal-123',
      );

      expect(result).toEqual(['tx-hash-123']);
      expect(mockStellarService.releaseEscrow).toHaveBeenCalledTimes(3);
    });

    it('should throw error after 3 failed attempts', async () => {
      const opNoTrustError = {
        response: {
          data: {
            extras: {
              result_codes: {
                operations: ['op_no_trust'],
              },
            },
          },
        },
        message: 'op_no_trust',
      };

      const mockStellarService = {
        releaseEscrow: jest.fn().mockRejectedValue(opNoTrustError),
      } as any;

      (service as any).stellarService = mockStellarService;

      const investorShares = [
        { walletAddress: 'INVESTOR1', tokenAmount: 100, totalTokens: 100 },
      ];

      await expect(
        (service as any).releaseEscrowWithMergeRecovery(
          'ESCROW_SECRET',
          'FARMER_WALLET',
          investorShares,
          'PLATFORM_WALLET',
          1000,
          'deal-123',
        ),
      ).rejects.toThrow();

      expect(mockStellarService.releaseEscrow).toHaveBeenCalledTimes(3);
    });
  });
});
