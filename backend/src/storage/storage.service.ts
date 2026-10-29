import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  RestoreObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import { isValidIpfsCid, verifyIpfsContent } from '../documents/ipfs-cid';
import { StorageContent } from './entities/storage-content.entity';

export interface StorageResult {
  hash: string;
  url: string;
}

export interface RestoreStatus {
  isRestoring: boolean;
  restoreExpiresAt?: Date;
  availableUntil?: Date;
  expedited?: boolean;
  message: string;
}

interface CachedContent {
  data: Buffer;
  expiresAt: number;
}

export interface StorageAnalytics {
  contentCount: number;
  totalBytes: number;
  estimatedMonthlyCost: number;
  underReplicatedCount: number;
  archivedCount: number;
  unaccessedCount: number;
  retrievalCount: number;
  averageRetrievalMs: number;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly ipfsGateway: string;
  private readonly ipfsToken: string;
  private readonly ipfsUnpinEndpoint: string;
  private readonly ipfsGateways: string[];
  private readonly clusterApis: string[];
  private readonly clusterReplicationMin: number;
  private readonly clusterReplicationMax: number;
  private readonly clusterAuth:
    { username: string; password: string } | undefined;
  private readonly pinataJwt: string;
  private readonly cdnGateway: string;
  private readonly minimumReplicas: number;
  private readonly cacheTtlMs: number;
  private readonly costPerGbMonth: number;
  private readonly s3Bucket: string;
  private readonly s3Region: string;
  private readonly hotContent = new Map<string, CachedContent>();

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(StorageContent)
    private readonly contentRepository: Repository<StorageContent>,
  ) {
    this.ipfsGateway = config.get<string>(
      'IPFS_GATEWAY',
      'https://api.web3.storage',
    );
    this.ipfsToken = config.get<string>('IPFS_TOKEN', '');
    this.ipfsUnpinEndpoint = config.get<string>('IPFS_UNPIN_ENDPOINT', '');
    this.ipfsGateways = [
      this.ipfsGateway,
      ...config
        .get<string>('IPFS_GATEWAYS', '')
        .split(',')
        .map((gateway) => gateway.trim().replace(/\/$/, ''))
        .filter(Boolean),
    ].filter((gateway, index, gateways) => gateways.indexOf(gateway) === index);
    this.clusterApis = config
      .get<string>('IPFS_CLUSTER_APIS', '')
      .split(',')
      .map((api) => api.trim().replace(/\/$/, ''))
      .filter(Boolean);
    this.clusterReplicationMin = Math.max(
      1,
      Number(config.get<string>('IPFS_CLUSTER_REPLICATION_MIN', '2')) || 2,
    );
    this.clusterReplicationMax = Math.max(
      this.clusterReplicationMin,
      Number(config.get<string>('IPFS_CLUSTER_REPLICATION_MAX', '3')) || 3,
    );
    const clusterUsername = config.get<string>('IPFS_CLUSTER_USER', '');
    const clusterPassword = config.get<string>('IPFS_CLUSTER_PASSWORD', '');
    this.clusterAuth = clusterUsername
      ? { username: clusterUsername, password: clusterPassword }
      : undefined;
    this.pinataJwt = config.get<string>('PINATA_JWT', '');
    this.cdnGateway = config
      .get<string>('IPFS_CDN_GATEWAY', '')
      .replace(/\/$/, '');
    this.minimumReplicas = Math.max(
      1,
      Number(config.get<string>('IPFS_MIN_REPLICAS', '1')) || 1,
    );
    this.cacheTtlMs = Math.max(
      0,
      Number(config.get<string>('IPFS_HOT_CACHE_TTL_SECONDS', '300')) * 1000,
    );
    this.costPerGbMonth = Math.max(
      0,
      Number(config.get<string>('IPFS_COST_PER_GB_MONTH', '0')) || 0,
    );
    this.s3Bucket = config.get<string>('AWS_S3_BUCKET', '');
    this.s3Region = config.get<string>('AWS_REGION', 'us-east-1');

    this.s3 = new S3Client({
      region: this.s3Region,
      credentials: {
        accessKeyId: config.get<string>('AWS_ACCESS_KEY_ID', ''),
        secretAccessKey: config.get<string>('AWS_SECRET_ACCESS_KEY', ''),
      },
    });
  }

  async upload(file: Buffer, mimeType: string): Promise<StorageResult> {
    try {
      return await this.uploadToIpfs(file, mimeType);
    } catch (ipfsErr) {
      this.logger.warn(
        `IPFS upload failed: ${ipfsErr.message}. Falling back to S3.`,
      );
    }

    try {
      return await this.uploadToS3(file, mimeType);
    } catch (s3Err) {
      this.logger.error(`S3 upload also failed: ${s3Err.message}`);
    }

    throw new ServiceUnavailableException(
      'File upload failed: both IPFS and S3 are unavailable.',
    );
  }

  async getUrl(hash: string): Promise<string> {
    // S3 keys contain '/' or start with a UUID pattern; CIDs start with 'Qm' or 'bafy'
    if (hash.startsWith('Qm') || hash.startsWith('bafy')) {
      return `${this.cdnGateway || this.ipfsGateway}/ipfs/${hash}`;
    }
    return `https://${this.s3Bucket}.s3.${this.s3Region}.amazonaws.com/${hash}`;
  }

  /**
   * Fetches an IPFS document and verifies its bytes against the stored CID.
   * Gateway responses are untrusted until this check succeeds.
   */
  async fetchAndVerifyIpfsDocument(
    cidString: string,
    useCache = true,
  ): Promise<Buffer> {
    if (!isValidIpfsCid(cidString)) {
      throw new UnprocessableEntityException('Stored IPFS CID is invalid.');
    }

    const inventory = await this.contentRepository.findOneBy({
      cid: cidString,
    });
    if (inventory?.archived && inventory.archiveKey) {
      const archived = await this.getDocument(inventory.archiveKey);
      if (!archived.data) {
        throw new ServiceUnavailableException(
          `Archived document is restoring from S3: ${archived.status.message}`,
        );
      }
      if (!verifyIpfsContent(cidString, archived.data)) {
        throw new ConflictException(
          'Archived document does not match its stored IPFS CID.',
        );
      }
      await this.recordAccess(cidString, 0);
      return archived.data;
    }

    const cached = useCache ? this.hotContent.get(cidString) : undefined;
    if (cached && cached.expiresAt > Date.now()) {
      this.hotContent.delete(cidString);
      this.hotContent.set(cidString, cached);
      await this.recordAccess(cidString, 0);
      return cached.data;
    }
    if (useCache) this.hotContent.delete(cidString);

    let lastError: Error | undefined;
    let integrityError: ConflictException | undefined;
    const retrievalStartedAt = Date.now();
    for (const gateway of this.ipfsGateways) {
      try {
        const response = await axios.get(`${gateway}/ipfs/${cidString}`, {
          responseType: 'arraybuffer',
          headers:
            gateway === this.ipfsGateway && this.ipfsToken
              ? { Authorization: `Bearer ${this.ipfsToken}` }
              : undefined,
          timeout: 10_000,
        });
        const data = Buffer.from(response.data);
        if (!verifyIpfsContent(cidString, data)) {
          this.logger.error(
            `IPFS CID mismatch for ${cidString} from ${gateway}`,
          );
          throw new ConflictException(
            'Retrieved document content does not match its stored IPFS CID.',
          );
        }

        if (useCache) this.cacheContent(cidString, data);
        await this.recordAccess(cidString, Date.now() - retrievalStartedAt);
        return data;
      } catch (err: any) {
        if (err instanceof ConflictException) {
          integrityError = err;
        } else {
          lastError = err;
        }
      }
    }

    try {
      await this.replicateCid(cidString);
    } catch (err: any) {
      this.logger.warn(
        `Could not repair IPFS pins for ${cidString}: ${err.message}`,
      );
    }
    if (integrityError) throw integrityError;
    if (lastError) {
      this.logger.error(
        `Failed to retrieve IPFS document ${cidString}: ${lastError.message}`,
      );
      throw new ServiceUnavailableException(
        `Failed to retrieve IPFS document: ${lastError.message}`,
      );
    }
    throw new ServiceUnavailableException('No IPFS gateway is configured.');
  }

  /**
   * Retrieves a document from S3, handling Glacier archive restore gracefully.
   *
   * Glacier Instant Retrieval: Restored in milliseconds (instant access)
   * Standard Glacier: Requires restore request, then available for 12-24 hours
   *
   * Flow:
   * 1. Check object metadata to detect storage class
   * 2. If in Glacier and not restored, initiate async restore
   * 3. Return restore status or object data if available
   */
  async getDocument(
    s3Key: string,
  ): Promise<{ data?: Buffer; status: RestoreStatus }> {
    // S3 keys that are IPFS hashes should use IPFS gateway
    if (s3Key.startsWith('Qm') || s3Key.startsWith('bafy')) {
      throw new NotFoundException(
        'Document retrieval only supports S3-stored documents. Use getUrl() for IPFS.',
      );
    }

    try {
      // Check object metadata to determine storage class and restore status
      const headResponse = await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.s3Bucket,
          Key: s3Key,
        }),
      );

      const storageClass = headResponse.StorageClass || 'STANDARD';
      const isGlacier = storageClass.includes('GLACIER');
      const isRestoreInProgress =
        headResponse.Restore?.includes('ongoing-request="true"') ?? false;
      const restoreExpiresAt = headResponse.Restore
        ? this.parseRestoreExpiration(headResponse.Restore)
        : undefined;

      // ── Handle Glacier restore scenarios ────────────────────────────────────
      if (isGlacier) {
        if (isRestoreInProgress) {
          // Restore already in progress
          return {
            status: {
              isRestoring: true,
              restoreExpiresAt: restoreExpiresAt || undefined,
              message: `Document is in Glacier archive. Restore in progress. Available in ~1-12 hours depending on restore tier.`,
            },
          };
        }

        if (restoreExpiresAt && restoreExpiresAt > new Date()) {
          // Previously restored, still available
          this.logger.debug(
            `Document ${s3Key} restored, available until ${restoreExpiresAt}`,
          );
          return await this.fetchDocumentFromS3(s3Key, storageClass);
        }

        // Not restored yet, initiate restore (async)
        await this.initiateGlacierRestore(s3Key, storageClass);
        return {
          status: {
            isRestoring: true,
            message: `Document is in Glacier archive. Restore initiated. Will be available in ~1-12 hours. We'll notify you when ready.`,
          },
        };
      }

      // ── Standard/Standard-IA storage - fetch immediately ───────────────────
      return await this.fetchDocumentFromS3(s3Key, storageClass);
    } catch (err: any) {
      this.logger.error(`Failed to retrieve document ${s3Key}: ${err.message}`);
      throw new ServiceUnavailableException(
        `Failed to retrieve document: ${err.message}`,
      );
    }
  }

  async getStorageAnalytics(): Promise<StorageAnalytics> {
    const records = await this.contentRepository.find();
    const now = Date.now();
    const unusedBefore = now - 90 * 24 * 60 * 60 * 1000;
    const totalBytes = records.reduce(
      (total, record) => total + Number(record.sizeBytes || 0),
      0,
    );
    const retrievalCount = records.reduce(
      (total, record) => total + Number(record.retrievalCount || 0),
      0,
    );
    const weightedRetrievalMs = records.reduce(
      (total, record) =>
        total +
        Number(record.averageRetrievalMs || 0) *
          Number(record.retrievalCount || 0),
      0,
    );

    return {
      contentCount: records.length,
      totalBytes,
      estimatedMonthlyCost: (totalBytes / 1_000_000_000) * this.costPerGbMonth,
      underReplicatedCount: records.filter(
        (record) =>
          !record.archived && record.replicaCount < this.minimumReplicas,
      ).length,
      archivedCount: records.filter((record) => record.archived).length,
      unaccessedCount: records.filter(
        (record) =>
          !record.lastAccessedAt && record.createdAt.getTime() < unusedBefore,
      ).length,
      retrievalCount,
      averageRetrievalMs:
        retrievalCount > 0 ? weightedRetrievalMs / retrievalCount : 0,
    };
  }

  async getCleanupCandidates(idleDays = 90): Promise<StorageContent[]> {
    const unusedBefore = Date.now() - idleDays * 24 * 60 * 60 * 1000;
    const records = await this.contentRepository.find();
    return records.filter((record) => {
      const lastActivity = record.lastAccessedAt || record.createdAt;
      const retentionExpired =
        !record.retentionUntil || record.retentionUntil.getTime() <= Date.now();
      return (
        !record.legalHold &&
        retentionExpired &&
        lastActivity.getTime() < unusedBefore
      );
    });
  }

  async setRetentionPolicy(
    cid: string,
    retentionUntil: Date | null,
    legalHold = false,
  ): Promise<void> {
    const record = await this.requireContent(cid);
    record.retentionUntil = retentionUntil;
    record.legalHold = legalHold;
    await this.contentRepository.save(record);
  }

  async archiveContent(cid: string): Promise<void> {
    const record = await this.requireContent(cid);
    if (!this.hasUnpinProvider()) {
      throw new ServiceUnavailableException(
        'Cannot archive IPFS content without a configured unpin provider.',
      );
    }
    const content = await this.fetchAndVerifyIpfsDocument(cid, false);
    const archiveKey = `ipfs-archive/${cid}`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.s3Bucket,
        Key: archiveKey,
        Body: content,
        ContentType: 'application/octet-stream',
      }),
    );
    await this.unpinContent(cid);
    record.archived = true;
    record.archiveKey = archiveKey;
    record.replicaCount = 0;
    await this.contentRepository.save(record);
    this.hotContent.delete(cid);
  }

  async eraseContent(cid: string, overrideRetention = false): Promise<void> {
    const record = await this.requireContent(cid);
    if (record.legalHold) {
      throw new ConflictException(
        'Content is under legal hold and cannot be erased.',
      );
    }
    if (
      !overrideRetention &&
      record.retentionUntil &&
      record.retentionUntil.getTime() > Date.now()
    ) {
      throw new ConflictException('Content retention period has not expired.');
    }

    this.hotContent.delete(cid);
    await this.unpinContent(cid);
    if (record.archiveKey) {
      await this.s3.send(
        new DeleteObjectCommand({
          Bucket: this.s3Bucket,
          Key: record.archiveKey,
        }),
      );
    }
    await this.contentRepository.delete({ cid });
  }

  private hasUnpinProvider(): boolean {
    return Boolean(
      this.ipfsUnpinEndpoint || this.clusterApis.length || this.pinataJwt,
    );
  }

  private async unpinContent(cid: string): Promise<void> {
    const unpinOperations: Promise<unknown>[] = [];
    if (this.ipfsUnpinEndpoint) {
      const endpoint = this.ipfsUnpinEndpoint.includes('{cid}')
        ? this.ipfsUnpinEndpoint.replace('{cid}', encodeURIComponent(cid))
        : `${this.ipfsUnpinEndpoint.replace(/\/$/, '')}/${encodeURIComponent(cid)}`;
      unpinOperations.push(
        axios.delete(endpoint, {
          headers: this.ipfsToken
            ? { Authorization: `Bearer ${this.ipfsToken}` }
            : undefined,
          timeout: 10_000,
          validateStatus: (status) =>
            (status >= 200 && status < 300) || status === 404,
        }),
      );
    }
    for (const api of this.clusterApis) {
      unpinOperations.push(
        axios.delete(`${api}/pins/${encodeURIComponent(cid)}`, {
          auth: this.clusterAuth,
          timeout: 10_000,
          validateStatus: (status) =>
            (status >= 200 && status < 300) || status === 404,
        }),
      );
    }
    if (this.pinataJwt) {
      unpinOperations.push(
        axios.delete(
          `https://api.pinata.cloud/pinning/unpin/${encodeURIComponent(cid)}`,
          {
            headers: { Authorization: `Bearer ${this.pinataJwt}` },
            timeout: 10_000,
            validateStatus: (status) =>
              (status >= 200 && status < 300) || status === 404,
          },
        ),
      );
    }
    if (!unpinOperations.length) {
      throw new ServiceUnavailableException(
        'No IPFS unpin provider is configured; content was not erased.',
      );
    }
    await Promise.all(unpinOperations);
  }

  async pinContent(cid: string): Promise<number> {
    if (!isValidIpfsCid(cid)) {
      throw new UnprocessableEntityException('IPFS CID is invalid.');
    }
    const replicaCount = await this.replicateCid(cid);
    const existing = await this.contentRepository.findOneBy({ cid });
    await this.saveInventory(
      cid,
      Number(existing?.sizeBytes || 0),
      replicaCount,
    );
    return replicaCount;
  }

  @Cron(CronExpression.EVERY_6_HOURS)
  async verifyTrackedContent(): Promise<void> {
    const records = await this.contentRepository.find({
      take: 100,
      order: { updatedAt: 'ASC' },
    });
    for (const record of records) {
      try {
        await this.fetchAndVerifyIpfsDocument(record.cid, false);
        record.lastVerifiedAt = new Date();
        if (!record.archived && record.replicaCount < this.minimumReplicas) {
          record.replicaCount = await this.replicateCid(record.cid);
        }
        await this.contentRepository.save(record);
      } catch (err: any) {
        this.logger.error(
          `Integrity check failed for ${record.cid}: ${err.message}`,
        );
        try {
          record.replicaCount = await this.replicateCid(record.cid);
          await this.contentRepository.save(record);
        } catch (repairError: any) {
          this.logger.error(
            `Pin repair failed for ${record.cid}: ${repairError.message}`,
          );
        }
      }
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async eraseExpiredContent(): Promise<void> {
    const expired = await this.contentRepository
      .createQueryBuilder('content')
      .where('content.retentionUntil <= :now', { now: new Date() })
      .andWhere('content.legalHold = false')
      .getMany();
    for (const record of expired) {
      try {
        await this.eraseContent(record.cid);
      } catch (err: any) {
        this.logger.error(
          `Could not erase expired content ${record.cid}: ${err.message}`,
        );
      }
    }
  }

  private async requireContent(cid: string): Promise<StorageContent> {
    const record = await this.contentRepository.findOneBy({ cid });
    if (!record) throw new NotFoundException('Storage content was not found.');
    return record;
  }

  private cacheContent(cid: string, data: Buffer): void {
    if (!this.cacheTtlMs) return;
    this.hotContent.delete(cid);
    this.hotContent.set(cid, {
      data,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
    while (this.hotContent.size > 100) {
      const oldest = this.hotContent.keys().next().value;
      if (!oldest) break;
      this.hotContent.delete(oldest);
    }
  }

  private async recordAccess(cid: string, retrievalMs: number): Promise<void> {
    try {
      const record = await this.contentRepository.findOneBy({ cid });
      if (!record) return;
      const count = Number(record.retrievalCount || 0);
      record.averageRetrievalMs =
        (Number(record.averageRetrievalMs || 0) * count + retrievalMs) /
        (count + 1);
      record.retrievalCount = count + 1;
      record.lastAccessedAt = new Date();
      await this.contentRepository.save(record);
    } catch (err: any) {
      this.logger.warn(`Could not record access for ${cid}: ${err.message}`);
    }
  }

  private async replicateCid(cid: string): Promise<number> {
    const replication = await Promise.allSettled([
      ...this.clusterApis.map((api) =>
        axios.post(
          `${api}/pins/${encodeURIComponent(cid)}?replication-min=${this.clusterReplicationMin}&replication-max=${this.clusterReplicationMax}`,
          {},
          { auth: this.clusterAuth, timeout: 15_000 },
        ),
      ),
      ...(this.pinataJwt
        ? [
            axios.post(
              'https://api.pinata.cloud/pinning/pinByHash',
              { hashToPin: cid },
              {
                headers: { Authorization: `Bearer ${this.pinataJwt}` },
                timeout: 15_000,
              },
            ),
          ]
        : []),
    ]);
    const clusterReplicaCount = replication.reduce((total, result, index) => {
      if (result.status !== 'fulfilled') return total;
      const isCluster = index < this.clusterApis.length;
      return total + (isCluster ? this.clusterReplicationMin : 1);
    }, 0);
    const replicaCount = 1 + clusterReplicaCount;
    if (replicaCount < this.minimumReplicas) {
      throw new Error(
        `CID ${cid} has ${replicaCount} replicas; ${this.minimumReplicas} required.`,
      );
    }
    return replicaCount;
  }

  private async saveInventory(
    cid: string,
    sizeBytes: number,
    replicaCount: number,
  ): Promise<void> {
    try {
      const existing = await this.contentRepository.findOneBy({ cid });
      const record = existing || this.contentRepository.create({ cid });
      record.sizeBytes = sizeBytes;
      record.replicaCount = replicaCount;
      record.lastVerifiedAt = new Date();
      await this.contentRepository.save(record);
    } catch (err: any) {
      this.logger.error(
        `Could not persist storage inventory for ${cid}: ${err.message}`,
      );
    }
  }

  /**
   * Initiates asynchronous restore from Glacier storage.
   * Uses Glacier Instant Retrieval tier (1-12 hours) by default for cost efficiency.
   * Standard Glacier restoration (24-48 hours) available for bulk/archival scenarios.
   */
  private async initiateGlacierRestore(
    s3Key: string,
    storageClass: string,
  ): Promise<void> {
    try {
      // Determine restore tier based on storage class
      const tier =
        storageClass === 'GLACIER_IR'
          ? 'Instant' // Glacier Instant Retrieval: milliseconds
          : storageClass === 'GLACIER'
            ? 'Standard' // Standard Glacier: 3-5 hours
            : 'Expedited'; // Deep Archive: 12 hours (highest cost but fastest for archive)

      await this.s3.send(
        new RestoreObjectCommand({
          Bucket: this.s3Bucket,
          Key: s3Key,
          RestoreRequest: {
            Days: 1, // Restore available for 1 day after completion
            GlacierJobParameters: {
              Tier: tier as 'Expedited' | 'Standard' | 'Bulk',
            },
          },
        }),
      );

      this.logger.log(
        `Initiated ${tier} restore for Glacier document ${s3Key}. Will be available in ${
          tier === 'Instant'
            ? 'milliseconds'
            : tier === 'Standard'
              ? '3-5 hours'
              : '12 hours'
        }`,
      );
    } catch (err: any) {
      // 409 Conflict = restore already in progress
      if (err.name === 'ConflictException') {
        this.logger.log(`Restore already in progress for ${s3Key}`);
        return;
      }
      throw err;
    }
  }

  /**
   * Fetches document from S3, handling both immediate access
   * and temporary restored access (for Glacier archives).
   */
  private async fetchDocumentFromS3(
    s3Key: string,
    storageClass: string,
  ): Promise<{ data: Buffer; status: RestoreStatus }> {
    try {
      const response = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.s3Bucket,
          Key: s3Key,
        }),
      );

      // Convert stream to buffer
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      const data = Buffer.concat(chunks);

      const restoreExpiresAt = response.Restore
        ? this.parseRestoreExpiration(response.Restore)
        : undefined;

      return {
        data,
        status: {
          isRestoring: false,
          availableUntil: restoreExpiresAt,
          message: `Document retrieved successfully from ${storageClass} storage.`,
        },
      };
    } catch (err: any) {
      this.logger.error(`Failed to fetch document ${s3Key}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Parses S3 Restore header to extract expiration date.
   * Format: ongoing-request="true|false", expiry-date="RFC3339Date"
   * Example: ongoing-request="false", expiry-date="2024-12-25T12:30:00Z"
   */
  private parseRestoreExpiration(restoreHeader: string): Date | undefined {
    const match = restoreHeader.match(/expiry-date="([^"]+)"/);
    if (!match || !match[1]) return undefined;
    try {
      return new Date(match[1]);
    } catch {
      return undefined;
    }
  }

  private async uploadToIpfs(
    file: Buffer,
    mimeType: string,
  ): Promise<StorageResult> {
    const response = await axios.post(`${this.ipfsGateway}/upload`, file, {
      headers: {
        Authorization: `Bearer ${this.ipfsToken}`,
        'Content-Type': mimeType,
      },
      maxBodyLength: Infinity,
    });

    const cid: string = response.data?.cid;
    if (!cid) {
      throw new Error('IPFS response did not include a CID.');
    }

    const replicaCount = await this.replicateCid(cid);
    await this.saveInventory(cid, file.length, replicaCount);

    return {
      hash: cid,
      url: `${this.cdnGateway || this.ipfsGateway}/ipfs/${cid}`,
    };
  }

  private async uploadToS3(
    file: Buffer,
    mimeType: string,
  ): Promise<StorageResult> {
    const key = `uploads/${randomUUID()}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.s3Bucket,
        Key: key,
        Body: file,
        ContentType: mimeType,
      }),
    );

    return {
      hash: key,
      url: `https://${this.s3Bucket}.s3.${this.s3Region}.amazonaws.com/${key}`,
    };
  }
}
