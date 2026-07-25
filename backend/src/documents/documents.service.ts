import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { LazyModuleLoader } from '@nestjs/core';
import { StorageService } from '../storage/storage.service';
import { StorageModule } from '../storage/storage.module';
import { StellarService } from '../stellar/stellar.service';
import { TradeDealsService } from '../trade-deals/trade-deals.service';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { buildDocumentMemo } from '../stellar/anchor-memo';
import { isValidIpfsCid } from './ipfs-cid';
// openpgp@4 is CommonJS-compatible; openpgp@5+ is ESM-only and would break here.
import * as openpgp from 'openpgp';
// file-type@17+ is ESM-only and would break here; v16 is the last CJS release.
import { fromBuffer as fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

@Injectable()
export class DocumentsService {
  private storageServicePromise: Promise<StorageService> | null = null;

  constructor(
    private readonly lazyModuleLoader: LazyModuleLoader,
    private readonly stellarService: StellarService,
    private readonly tradeDealsService: TradeDealsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * StorageModule constructs an S3Client on init, so it's excluded from
   * DocumentsModule's static imports and loaded on first use instead —
   * document upload is the only feature that needs it.
   */
  private async getStorageService(): Promise<StorageService> {
    if (!this.storageServicePromise) {
      this.storageServicePromise = this.lazyModuleLoader
        .load(() => StorageModule)
        .then((moduleRef) => moduleRef.get(StorageService));
    }
    return this.storageServicePromise;
  }

  async handleUpload({
    file,
    docType,
    tradeDealId,
    userId,
    signatureAsc,
  }: {
    file: Express.Multer.File;
    docType: string;
    tradeDealId: string;
    userId: string;
    signatureAsc?: string;
  }) {
    // 0. Verify the file's actual signature (magic number) matches the
    //    declared MIME type. Extension/header checks alone can be spoofed.
    await this.verifyFileSignature(file.buffer, file.mimetype);

    // 1. Compress file before upload to save storage space
    const { buffer: compressedBuffer, mimeType: compressedMimeType } =
      await this.compressFile(file.buffer, file.mimetype);

    // 2. Upload (IPFS → S3 fallback handled internally)
    const storageService = await this.getStorageService();
    const { hash, url } = await storageService.upload(
      compressedBuffer,
      compressedMimeType,
    );

    if (!isValidIpfsCid(hash)) {
      throw new BadGatewayException(
        'Storage provider returned an invalid IPFS CID.',
      );
    }

    // 3. Anchor the IPFS CID on Stellar via Memo.hash(SHA-256(CID))
    const signerSecret = this.config.get<string>('STELLAR_PLATFORM_SECRET', '');
    const cidHash = createHash('sha256').update(hash).digest('hex');
    const memo = buildDocumentMemo(tradeDealId, cidHash);
    const { txId: stellarTxId } = await this.stellarService.anchorIpfsCid(
      hash,
      signerSecret,
    );

    // 4. Verify detached GnuPG signature if one was supplied (max 4 KB to
    //    prevent CPU exhaustion from oversized armored payloads).
    //    Verification uses the original (pre-compression) buffer since the
    //    signature was created against the source document.
    let signatureVerified = false;
    if (signatureAsc && signatureAsc.length <= 4096) {
      signatureVerified = await this.verifySignature(file.buffer, signatureAsc);
    }

    // 5. Persist using existing logic (VERY IMPORTANT)
    const doc = await this.tradeDealsService.addDocument({
      tradeDealId,
      uploaderId: userId,
      docType,
      ipfsHash: hash,
      storageUrl: url,
      stellarTxId,
      fileSizeBytes: compressedBuffer.length,
      memoText: memo,
      signatureVerified,
    });

    return {
      ...doc,
      verificationUrl: this.stellarService.getVerificationUrl(stellarTxId),
    };
  }

  /** Inspects the file buffer's magic number and rejects it if the actual
   *  signature doesn't match the declared MIME type. */
  private async verifyFileSignature(
    buffer: Buffer,
    declaredMimeType: string,
  ): Promise<void> {
    const detected = await fileTypeFromBuffer(buffer);

    if (!detected || !ALLOWED_MIME_TYPES.includes(detected.mime)) {
      throw new BadRequestException(
        'File signature does not match a supported document type (PDF, PNG, JPEG).',
      );
    }

    if (detected.mime !== declaredMimeType) {
      throw new BadRequestException(
        'File signature does not match the declared file type.',
      );
    }
  }

  private async compressFile(
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    if (mimeType.startsWith('image/')) {
      const image = sharp(buffer);
      const metadata = await image.metadata();
      if (
        (metadata.width && metadata.width > 2000) ||
        (metadata.height && metadata.height > 2000)
      ) {
        image.resize(2000, 2000, { fit: 'inside', withoutEnlargement: true });
      }
      const compressed = await image.webp().toBuffer();
      return { buffer: compressed, mimeType: 'image/webp' };
    }

    if (mimeType === 'application/pdf') {
      const pdfDoc = await PDFDocument.load(buffer);
      const compressed = await pdfDoc.save({ useObjectStreams: true });
      return { buffer: Buffer.from(compressed), mimeType };
    }

    return { buffer, mimeType };
  }

  private async verifySignature(
    fileBuffer: Buffer,
    armoredSig: string,
  ): Promise<boolean> {
    const trustedKeysRaw = this.config.get<string>(
      'TRUSTED_AUTHORITY_KEYS',
      '',
    );
    if (!trustedKeysRaw) return false;
    try {
      const publicKeys: openpgp.key.Key[] = [];
      for (const raw of trustedKeysRaw.split(',')) {
        const trimmed = raw.trim();
        if (!trimmed) continue;
        const { keys, err } = await openpgp.key.readArmored(trimmed);
        if (err && err.length) continue;
        publicKeys.push(...keys);
      }
      if (!publicKeys.length) return false;

      const message = openpgp.message.fromBinary(new Uint8Array(fileBuffer));
      const signature = await openpgp.signature.readArmored(armoredSig);
      const result = await openpgp.verify({ message, signature, publicKeys });

      const validities = await Promise.all(
        result.signatures.map((s: any) => s.valid),
      );
      return validities.some((v: boolean | null) => v === true);
    } catch {
      return false;
    }
  }
}
