import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { StorageService } from './storage.service';
import { StorageServiceMock } from './storage.service.mock';
import { IpfsGatewayMonitorService } from './ipfs-gateway-monitor.service';

const useMockStorage =
  process.env.NODE_ENV === 'test' || process.env.USE_STORAGE_MOCK === 'true';

@Module({
  imports: [HttpModule],
  providers: [
    {
      provide: StorageService,
      useClass: useMockStorage ? StorageServiceMock : StorageService,
    },
    IpfsGatewayMonitorService,
  ],
  exports: [StorageService, IpfsGatewayMonitorService],
})
export class StorageModule {}
