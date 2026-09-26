import { Injectable } from '@nestjs/common';
import BigNumber from 'bignumber.js';

@Injectable()
export class EscrowReleaseService {
  calculateReleasePlan(totalValue: number, investorShares: Array<{ tokenAmount: number }>) {
    const totalValueBN = new BigNumber(totalValue);
    const totalStroopsBN = totalValueBN.multipliedBy(1e7);

    if (totalStroopsBN.isLessThanOrEqualTo(0)) {
      throw new Error('Invalid totalValue');
    }

    const platformStroopsBN = totalStroopsBN
      .multipliedBy(0.02)
      .integerValue(BigNumber.ROUND_FLOOR);
    const investorPoolStroopsBN = totalStroopsBN.minus(platformStroopsBN);

    const totalTokens = investorShares.reduce((sum, s) => sum + s.tokenAmount, 0);
    if (totalTokens <= 0) {
      throw new Error('Invalid investor token distribution');
    }

    return {
      totalStroopsBN,
      platformStroops: platformStroopsBN.toNumber(),
      investorPoolStroops: investorPoolStroopsBN.toNumber(),
      totalTokens,
    };
  }
}
