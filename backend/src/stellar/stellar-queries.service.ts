import { Injectable } from '@nestjs/common';
import { Networks } from '@stellar/stellar-sdk';

@Injectable()
export class StellarQueriesService {
  getVerificationUrl(networkPassphrase: string, txHash: string): string {
    const baseUrl =
      networkPassphrase === Networks.TESTNET
        ? 'https://stellar.expert/explorer/testnet/tx'
        : 'https://stellar.expert/explorer/public/tx';
    return `${baseUrl}/${txHash}`;
  }
}
