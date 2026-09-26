import { Injectable } from '@nestjs/common';

@Injectable()
export class InvestmentTxService {
  computeReserveRequirement(subentryCount: number): number {
    return (subentryCount + 1) * 0.5 + 2 + 0.001;
  }

  buildInvestmentMemo(assetCode: string, tokenAmount: number, investmentMemo?: string): string {
    return investmentMemo || `invest:${assetCode}:${tokenAmount}`;
  }
}
