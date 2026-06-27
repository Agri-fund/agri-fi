import { BadGatewayException, Injectable } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import { StellarService } from '../stellar/stellar.service';
import { TradeDealsService } from '../trade-deals/trade-deals.service';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { buildDocumentMemo } from '../stellar/anchor-memo';
import { isValidIpfsCid } from './ipfs-cid';
// openpgp@4 is CommonJS-compatible; openpgp@5+ is ESM-only and would break here.
import * as openpgp from 'openpgp';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly storageService: StorageService,
    private readonly stellarService: StellarService,
    private readonly tradeDealsService: TradeDealsService,
    private readonly config: ConfigService,
  ) {}

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
    // 1. Upload (IPFS → S3 fallback handled internally)
    const { hash, url } = await this.storageService.upload(
      file.buffer,
      file.mimetype,
    );

    if (!isValidIpfsCid(hash)) {
      throw new BadGatewayException('Storage provider returned an invalid IPFS CID.');
    }

    // 2. Anchor the IPFS CID on Stellar via Memo.hash(SHA-256(CID))
    const signerSecret = this.config.get<string>('STELLAR_PLATFORM_SECRET', '');
    const cidHash = createHash('sha256').update(hash).digest('hex');
    const memo = buildDocumentMemo(tradeDealId, cidHash);
    const { txId: stellarTxId } = await this.stellarService.anchorIpfsCid(
      hash,
      signerSecret,
    );

    // 3. Verify detached GnuPG signature if one was supplied (max 4 KB to
    //    prevent CPU exhaustion from oversized armored payloads).
    let signatureVerified = false;
    if (signatureAsc && signatureAsc.length <= 4096) {
      signatureVerified = await this.verifySignature(file.buffer, signatureAsc);
    }

    // 4. Persist using existing logic (VERY IMPORTANT)
    const doc = await this.tradeDealsService.addDocument({
      tradeDealId,
      uploaderId: userId,
      docType,
      ipfsHash: hash,
      storageUrl: url,
      stellarTxId,
      fileSizeBytes: file.size,
      memoText: memo,
      signatureVerified,
    });

    return {
      ...doc,
      verificationUrl: this.stellarService.getVerificationUrl(stellarTxId),
    };
  }

  private async verifySignature(
    fileBuffer: Buffer,
    armoredSig: string,
  ): Promise<boolean> {
    const trustedKeysRaw = this.config.get<string>('TRUSTED_AUTHORITY_KEYS', '');
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
