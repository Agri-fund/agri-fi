import { Injectable } from '@nestjs/common';

@Injectable()
export class TokenIssuerService {
  async issueTradeToken(
    assetCode: string,
    escrowPublicKey: string,
    escrowSecret: string,
    tokenCount: number,
  ): Promise<{ txId: string; issuerPublicKey: string; issuerSecret: string }> {
    return {
      txId: 'mock-tx-id',
      issuerPublicKey: escrowPublicKey,
      issuerSecret: escrowSecret,
    };
  }
}
