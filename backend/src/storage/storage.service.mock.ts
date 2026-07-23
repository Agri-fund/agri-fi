import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { StorageResult } from './storage.service';

@Injectable()
export class StorageServiceMock {
  private readonly uploads = new Map<
    string,
    { file: Buffer; mimeType: string }
  >();

  async upload(file: Buffer, mimeType: string): Promise<StorageResult> {
    const digest = createHash('sha256').update(file).digest('hex');
    const hash = `bafy${digest.slice(0, 56)}`;

    this.uploads.set(hash, {
      file: Buffer.from(file),
      mimeType,
    });

    return {
      hash,
      url: this.getMockUrl(hash),
    };
  }

  async getUrl(hash: string): Promise<string> {
    return this.getMockUrl(hash);
  }

  private getMockUrl(hash: string): string {
    return `https://mock-storage.local/ipfs/${hash}`;
  }
}
