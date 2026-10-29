import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StorageService } from './storage.service';
import { StorageContent } from './entities/storage-content.entity';
import axios from 'axios';
import { createHash } from 'crypto';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function cidV0For(data: Buffer): string {
  const digest = Buffer.concat([
    Buffer.from([0x12, 0x20]),
    createHash('sha256').update(data).digest(),
  ]);
  let value = BigInt(`0x${digest.toString('hex')}`);
  let encoded = '';
  while (value > 0n) {
    encoded = BASE58[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  return `${'1'.repeat(digest.findIndex((byte) => byte !== 0))}${encoded}`;
}

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockContentRepository = {
  find: jest.fn(),
  findOneBy: jest.fn(),
  create: jest.fn((content) => content),
  save: jest.fn((content) => Promise.resolve(content)),
  delete: jest.fn(),
  createQueryBuilder: jest.fn(),
};

// Mock @aws-sdk/client-s3
const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn().mockImplementation((input) => input),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => input),
}));

const mockConfig = (overrides: Record<string, string> = {}) => ({
  get: jest.fn((key: string, defaultVal = '') => {
    const values: Record<string, string> = {
      IPFS_GATEWAY: 'https://api.web3.storage',
      IPFS_TOKEN: 'test-token',
      AWS_S3_BUCKET: 'test-bucket',
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'key-id',
      AWS_SECRET_ACCESS_KEY: 'secret',
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
    mockContentRepository.findOneBy.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: ConfigService, useValue: mockConfig() },
        {
          provide: getRepositoryToken(StorageContent),
          useValue: mockContentRepository,
        },
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

    it('replicates uploaded content to configured IPFS Cluster nodes', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StorageService,
          {
            provide: ConfigService,
            useValue: mockConfig({
              IPFS_CLUSTER_APIS: 'http://cluster-a:9094',
              IPFS_MIN_REPLICAS: '2',
              IPFS_CLUSTER_REPLICATION_MIN: '2',
              IPFS_CLUSTER_REPLICATION_MAX: '2',
            }),
          },
          {
            provide: getRepositoryToken(StorageContent),
            useValue: mockContentRepository,
          },
        ],
      }).compile();
      mockedAxios.post.mockResolvedValue({ data: { cid: 'QmTestCID123' } });

      const result = await module.get(StorageService).upload(file, mimeType);

      expect(result.hash).toBe('QmTestCID123');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://cluster-a:9094/pins/QmTestCID123?replication-min=2&replication-max=2',
        {},
        expect.objectContaining({ timeout: 15_000 }),
      );
      expect(mockContentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ cid: 'QmTestCID123', replicaCount: 3 }),
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

  describe('fetchAndVerifyIpfsDocument', () => {
    it('returns the document when the gateway bytes match the stored CID', async () => {
      const cid = cidV0For(file);
      mockedAxios.get.mockResolvedValue({ data: file });

      await expect(service.fetchAndVerifyIpfsDocument(cid)).resolves.toEqual(
        file,
      );
      expect(mockedAxios.get).toHaveBeenCalledWith(
        `https://api.web3.storage/ipfs/${cid}`,
        expect.objectContaining({ responseType: 'arraybuffer' }),
      );
    });

    it('rejects gateway bytes that do not match the stored CID', async () => {
      const cid = cidV0For(file);
      mockedAxios.get.mockResolvedValue({
        data: Buffer.from('tampered content'),
      });

      await expect(service.fetchAndVerifyIpfsDocument(cid)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('retention controls', () => {
    it('archives verified bytes to S3 before releasing cluster pins', async () => {
      const cid = cidV0For(file);
      const record = {
        cid,
        sizeBytes: file.length,
        replicaCount: 1,
        archived: false,
        archiveKey: null,
        legalHold: false,
        retentionUntil: null,
      };
      mockContentRepository.findOneBy.mockResolvedValue(record);
      mockedAxios.get.mockResolvedValue({ data: file });
      mockedAxios.delete.mockResolvedValue({ data: {} });
      mockS3Send.mockResolvedValue({});
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StorageService,
          {
            provide: ConfigService,
            useValue: mockConfig({
              IPFS_CLUSTER_APIS: 'http://cluster-a:9094',
            }),
          },
          {
            provide: getRepositoryToken(StorageContent),
            useValue: mockContentRepository,
          },
        ],
      }).compile();

      await module.get(StorageService).archiveContent(cid);

      expect(mockS3Send).toHaveBeenCalledWith(
        expect.objectContaining({ Key: `ipfs-archive/${cid}`, Body: file }),
      );
      expect(mockedAxios.delete).toHaveBeenCalledWith(
        `http://cluster-a:9094/pins/${cid}`,
        expect.any(Object),
      );
      expect(mockContentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          archived: true,
          archiveKey: `ipfs-archive/${cid}`,
          replicaCount: 0,
        }),
      );
    });

    it('refuses erasure while a content retention date is active', async () => {
      mockContentRepository.findOneBy.mockResolvedValue({
        cid: 'QmTestCID123',
        legalHold: false,
        retentionUntil: new Date(Date.now() + 60_000),
      });

      await expect(service.eraseContent('QmTestCID123')).rejects.toThrow(
        ConflictException,
      );
      expect(mockContentRepository.delete).not.toHaveBeenCalled();
    });

    it('does not claim erasure without a configured unpin provider', async () => {
      mockContentRepository.findOneBy.mockResolvedValue({
        cid: 'QmTestCID123',
        legalHold: false,
        retentionUntil: null,
      });

      await expect(service.eraseContent('QmTestCID123')).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(mockContentRepository.delete).not.toHaveBeenCalled();
    });

    it('backfills inventory when pinning an existing CID', async () => {
      const cid = cidV0For(file);
      mockedAxios.post.mockResolvedValue({ data: {} });

      await expect(service.pinContent(cid)).resolves.toBe(1);

      expect(mockContentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ cid, sizeBytes: 0, replicaCount: 1 }),
      );
    });
  });
});
