import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  RestoreObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { isValidIpfsCid, verifyIpfsContent } from '../documents/ipfs-cid';

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

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly ipfsGateway: string;
  private readonly ipfsToken: string;
  private readonly s3Bucket: string;
  private readonly s3Region: string;

  constructor(private readonly config: ConfigService) {
    this.ipfsGateway = config.get<string>(
      'IPFS_GATEWAY',
      'https://api.web3.storage',
    );
    this.ipfsToken = config.get<string>('IPFS_TOKEN', '');
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
      return `${this.ipfsGateway}/ipfs/${hash}`;
    }
    return `https://${this.s3Bucket}.s3.${this.s3Region}.amazonaws.com/${hash}`;
  }

  /**
   * Fetches an IPFS document and verifies its bytes against the stored CID.
   * Gateway responses are untrusted until this check succeeds.
   */
  async fetchAndVerifyIpfsDocument(cidString: string): Promise<Buffer> {
    if (!isValidIpfsCid(cidString)) {
      throw new UnprocessableEntityException('Stored IPFS CID is invalid.');
    }

    try {
      const response = await axios.get(
        `${this.ipfsGateway.replace(/\/$/, '')}/ipfs/${cidString}`,
        {
          responseType: 'arraybuffer',
          headers: this.ipfsToken
            ? { Authorization: `Bearer ${this.ipfsToken}` }
            : undefined,
        },
      );
      const data = Buffer.from(response.data);
      if (!verifyIpfsContent(cidString, data)) {
        this.logger.error(`IPFS CID mismatch for ${cidString}`);
        throw new ConflictException(
          'Retrieved document content does not match its stored IPFS CID.',
        );
      }

      return data;
    } catch (err: any) {
      if (err instanceof ConflictException || err instanceof UnprocessableEntityException) {
        throw err;
      }
      this.logger.error(`Failed to retrieve IPFS document ${cidString}: ${err.message}`);
      throw new ServiceUnavailableException(
        `Failed to retrieve IPFS document: ${err.message}`,
      );
    }
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

      this.logger.info(
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
        this.logger.info(`Restore already in progress for ${s3Key}`);
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

    return {
      hash: cid,
      url: `${this.ipfsGateway}/ipfs/${cid}`,
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
