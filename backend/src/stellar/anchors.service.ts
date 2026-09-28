import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

@Injectable()
export class AnchorsService {
  buildHashMemo(memo: string): Buffer {
    return createHash('sha256').update(memo).digest();
  }

  truncateMemoText(memo: string): string {
    return memo.slice(0, 28);
  }
}
