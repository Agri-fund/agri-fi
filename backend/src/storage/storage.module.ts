import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { StorageServiceMock } from './storage.service.mock';

const useMockStorage =
  process.env.NODE_ENV === 'test' || process.env.USE_STORAGE_MOCK === 'true';

@Module({
  providers: [
    {
      provide: StorageService,
      useClass: useMockStorage ? StorageServiceMock : StorageService,
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
