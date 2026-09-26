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

  it('rejects out-of-order chunk uploads with a structured error', () => {
    const { service } = createService(Promise.resolve({ isClean: true }));

    service.recordChunk('file-123', 0, 3, Buffer.from('first'));

    expect(() =>
      service.recordChunk('file-123', 2, 3, Buffer.from('skip')),
    ).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'CHUNK_OUT_OF_ORDER' }) }));
  });

  it('idempotently handles duplicate chunk uploads', () => {
    const { service } = createService(Promise.resolve({ isClean: true }));

    const first = service.recordChunk('file-123', 0, 3, Buffer.from('first'));
    const duplicate = service.recordChunk('file-123', 0, 3, Buffer.from('duplicate'));

    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
  });

  it('returns a resume cursor after interruption', () => {
    const { service } = createService(Promise.resolve({ isClean: true }));

    service.recordChunk('file-123', 0, 3, Buffer.from('first'));
    service.recordChunk('file-123', 1, 3, Buffer.from('second'));

    expect(service.getUploadCursor('file-123')).toMatchObject({
      fileId: 'file-123',
      nextChunkIndex: 2,
      receivedCount: 2,
      complete: false,
    });
  });

  it('expires incomplete uploads after TTL', () => {
    const { service } = createService(Promise.resolve({ isClean: true }));
    (service as any).uploadChunkSessionTtlMs = 0;
    service.recordChunk('file-123', 0, 2, Buffer.from('first'));

    expect(() => service.getUploadCursor('file-123')).toThrow();
  });

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
