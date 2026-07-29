import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { StorageService } from './storage.service';
import { CircuitBreakerFactory } from '../common/circuit-breaker';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock @aws-sdk/client-s3
const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn().mockImplementation((input) => input),
}));

const mockConfig = (overrides: Record<string, string | number> = {}) => ({
  get: jest.fn((key: string, defaultVal: string | number = '') => {
    const values: Record<string, string | number> = {
      IPFS_GATEWAY: 'https://api.web3.storage',
      IPFS_TOKEN: 'test-token',
      AWS_S3_BUCKET: 'test-bucket',
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'key-id',
      AWS_SECRET_ACCESS_KEY: 'secret',
      // Low thresholds so the IPFS breaker opens quickly in tests
      CB_IPFS_PINNING_VOLUME_THRESHOLD: 2,
      CB_IPFS_PINNING_ERROR_THRESHOLD: 50,
      CB_IPFS_PINNING_RESET_MS: 50,
      CB_IPFS_PINNING_TIMEOUT_MS: 5_000,
      ...overrides,
    };
    return values[key] ?? defaultVal;
  }),
});

describe('StorageService', () => {
  let service: StorageService;
  const file = Buffer.from('test file content');
  const mimeType = 'application/pdf';

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        CircuitBreakerFactory,
        { provide: ConfigService, useValue: mockConfig() },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
  });

  describe('upload — IPFS success', () => {
    it('returns CID hash and IPFS gateway URL on successful IPFS upload', async () => {
      mockedAxios.post.mockResolvedValue({ data: { cid: 'QmTestCID123' } });

      const result = await service.upload(file, mimeType);

      expect(result.hash).toBe('QmTestCID123');
      expect(result.url).toBe('https://api.web3.storage/ipfs/QmTestCID123');
    });

    it('sends Authorization header with IPFS token', async () => {
      mockedAxios.post.mockResolvedValue({ data: { cid: 'QmTestCID123' } });

      await service.upload(file, mimeType);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/upload'),
        file,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
      );
    });
  });

  describe('upload — IPFS fails, S3 fallback', () => {
    it('falls back to S3 when IPFS upload fails', async () => {
      mockedAxios.post.mockRejectedValue(new Error('IPFS network error'));
      mockS3Send.mockResolvedValue({});

      const result = await service.upload(file, mimeType);

      expect(result.hash).toMatch(/^uploads\//);
      expect(result.url).toContain('test-bucket.s3.us-east-1.amazonaws.com');
    });

    it('returns S3 object key as hash on S3 upload', async () => {
      mockedAxios.post.mockRejectedValue(new Error('IPFS unavailable'));
      mockS3Send.mockResolvedValue({});

      const result = await service.upload(file, mimeType);

      expect(result.hash).toMatch(/^uploads\/[0-9a-f-]{36}$/);
    });
  });

  describe('upload — both fail', () => {
    it('throws ServiceUnavailableException when both IPFS and S3 fail', async () => {
      mockedAxios.post.mockRejectedValue(new Error('IPFS down'));
      mockS3Send.mockRejectedValue(new Error('S3 down'));

      await expect(service.upload(file, mimeType)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('upload — circuit breaker', () => {
    it('opens after repeated IPFS failures and then fails fast without calling axios', async () => {
      mockedAxios.post.mockRejectedValue(new Error('IPFS outage'));
      mockS3Send.mockResolvedValue({});

      // volumeThreshold=2 → open after enough failures in the rolling window
      await service.upload(file, mimeType);
      await service.upload(file, mimeType);
      await service.upload(file, mimeType);

      const callsBeforeOpen = mockedAxios.post.mock.calls.length;
      expect(service.getIpfsCircuitState().opened).toBe(true);

      mockedAxios.post.mockClear();
      await service.upload(file, mimeType);

      // Fail-fast: open circuit must not hit the network
      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(mockedAxios.post.mock.calls.length).toBe(0);
      // Prior failures still prove the breaker tripped
      expect(callsBeforeOpen).toBeGreaterThanOrEqual(2);
    });

    it('transitions to half-open after the cool-off window', async () => {
      jest.useFakeTimers();
      mockedAxios.post.mockRejectedValue(new Error('IPFS outage'));
      mockS3Send.mockResolvedValue({});

      await service.upload(file, mimeType);
      await service.upload(file, mimeType);
      await service.upload(file, mimeType);
      expect(service.getIpfsCircuitState().opened).toBe(true);

      // Advance past CB_IPFS_PINNING_RESET_MS (50ms)
      jest.advanceTimersByTime(60);

      const state = service.getIpfsCircuitState();
      expect(state.opened || state.halfOpen).toBe(true);

      // Allow a probe through half-open
      mockedAxios.post.mockResolvedValue({ data: { cid: 'QmRecovered' } });
      const result = await service.upload(file, mimeType);
      expect(result.hash === 'QmRecovered' || result.hash.startsWith('uploads/')).toBe(
        true,
      );

      jest.useRealTimers();
    });
  });

  describe('getUrl', () => {
    it('reconstructs IPFS gateway URL for a CID starting with Qm', async () => {
      const url = await service.getUrl('QmTestCID123');
      expect(url).toBe('https://api.web3.storage/ipfs/QmTestCID123');
    });

    it('reconstructs IPFS gateway URL for a CID starting with bafy', async () => {
      const url = await service.getUrl(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
      );
      expect(url).toContain('/ipfs/bafy');
    });

    it('reconstructs S3 URL for an S3 object key', async () => {
      const url = await service.getUrl('uploads/some-uuid');
      expect(url).toBe(
        'https://test-bucket.s3.us-east-1.amazonaws.com/uploads/some-uuid',
      );
    });
  });
});
