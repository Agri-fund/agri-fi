import { Injectable } from '@nestjs/common';
import { StorageService } from '../storage/storage.service';
import { StellarService } from '../stellar/stellar.service';
import { TradeDealsService } from '../trade-deals/trade-deals.service';
import { ConfigService } from '@nestjs/config';

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

    // 2. Build Stellar memo (28 bytes safe)
    const memo = this.buildMemo(tradeDealId, hash);

    const signerSecret = this.config.get<string>('STELLAR_PLATFORM_SECRET', '');

    const stellarTxId = await this.stellarService.recordMemo(
      memo,
      signerSecret,
      'hash',
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
