import { Injectable } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import { StellarService } from '../stellar/stellar.service';
import { TradeDealsService } from '../trade-deals/trade-deals.service';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

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
  }: {
    file: Express.Multer.File;
    docType: string;
    tradeDealId: string;
    userId: string;
  }) {
    // 1. Upload (IPFS → S3 fallback handled internally)
    const { hash, url } = await this.storageService.upload(
      file.buffer,
      file.mimetype,
    );

    // 2. Calculate SHA-256 of the file for Stellar Anchoring
    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    const memo = this.buildMemo(tradeDealId, fileHash);

    const signerSecret = this.config.get<string>('STELLAR_PLATFORM_SECRET', '');

    const stellarTxId = await this.stellarService.recordDocumentHash(
      fileHash,
      signerSecret
    );

    // 3. Persist using existing logic (VERY IMPORTANT)
    return this.tradeDealsService.addDocument({
      tradeDealId,
      uploaderId: userId,
      docType,
      ipfsHash: hash,
      storageUrl: url,
      stellarTxId,
      fileSizeBytes: file.size,
      memoText: memo,
    });
  }

  private buildMemo(tradeDealId: string, hash: string): string {
    return `AGRIC:DOC:${tradeDealId}:${hash}`;
  }
}
