import {
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DocumentsService } from './documents.service';

describe('DocumentsService malware scanning', () => {
  const file = {
    originalname: 'document.pdf',
    buffer: Buffer.from('document'),
  } as Express.Multer.File;

  function createService(scanResult: Promise<unknown>) {
    const clamScanService = { scan: jest.fn(() => scanResult) };
    const auditService = { logEvent: jest.fn().mockResolvedValue(null) };
    const service = new DocumentsService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      clamScanService as any,
      auditService as any,
    );
    return { service, clamScanService, auditService };
  }

  it('allows clean files and records the scan', async () => {
    const { service, clamScanService, auditService } = createService(
      Promise.resolve({ isClean: true }),
    );

    await expect(
      service.scanBeforeUpload(file, 'user-1'),
    ).resolves.toBeUndefined();

    expect(clamScanService.scan).toHaveBeenCalledWith(file.buffer);
    expect(auditService.logEvent).not.toHaveBeenCalled();
  });

  it('rejects infected files with 422 and audits the rejection', async () => {
    const { service, auditService } = createService(
      Promise.resolve({ isClean: false, virusName: 'Eicar-Test-Signature' }),
    );

    await expect(
      service.scanBeforeUpload(file, 'user-1'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(auditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        statusCode: 422,
        requestDetails: expect.objectContaining({
          virusName: 'Eicar-Test-Signature',
        }),
      }),
    );
  });

  it('fails closed when ClamAV is unavailable', async () => {
    const { service, auditService } = createService(
      Promise.reject(new Error('ECONNREFUSED')),
    );

    await expect(
      service.scanBeforeUpload(file, 'user-1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(auditService.logEvent).not.toHaveBeenCalled();
  });
});
