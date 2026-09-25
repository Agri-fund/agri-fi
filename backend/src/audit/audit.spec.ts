import { SystemAuditLog } from './entities/system-audit-log.entity';
import { AuditService } from './audit.service';
import { AuditInterceptor } from './audit.interceptor';
import { of, throwError } from 'rxjs';

describe('AuditModule', () => {
  describe('SystemAuditLog Entity Immutability', () => {
    it('throws an error when preventUpdate hook is called', () => {
      const log = new SystemAuditLog();
      expect(() => log.preventUpdate()).toThrow(
        'SystemAuditLog entries are immutable and cannot be updated.',
      );
    });

    it('throws an error when preventRemove hook is called', () => {
      const log = new SystemAuditLog();
      expect(() => log.preventRemove()).toThrow(
        'SystemAuditLog entries are immutable and cannot be deleted.',
      );
    });
  });

  describe('AuditService', () => {
    let service: AuditService;
    let repoMock: any;

    beforeEach(() => {
      repoMock = {
        create: jest.fn((dto) => ({
          ...dto,
          id: 'uuid-123',
          timestamp: new Date(),
        })),
        save: jest.fn(async (entity) => entity),
        find: jest.fn(async () => []),
      };
      service = new AuditService(repoMock);
    });

    it('persists system event logs with actor, route, status, and request details', async () => {
      const eventData = {
        actorId: 'user-1',
        actorRole: 'admin',
        route: 'POST /api/v1/payouts',
        statusCode: 200,
        requestDetails: { amount: 500 },
      };

      const result = await service.logEvent(eventData);

      expect(repoMock.create).toHaveBeenCalledWith(eventData);
      expect(repoMock.save).toHaveBeenCalled();
      expect(result).toMatchObject(eventData);
    });

    it('handles database errors gracefully without throwing', async () => {
      repoMock.save.mockRejectedValueOnce(new Error('DB Connection Failed'));

      const result = await service.logEvent({ route: 'GET /' });

      expect(result).toBeNull();
    });
  });

  describe('AuditInterceptor', () => {
    let interceptor: AuditInterceptor;
    let auditServiceMock: any;

    beforeEach(() => {
      auditServiceMock = {
        logEvent: jest.fn().mockResolvedValue(null),
      };
      interceptor = new AuditInterceptor(auditServiceMock);
    });

    it('captures successful HTTP operations and logs asynchronously', (done) => {
      const mockReq = {
        method: 'POST',
        originalUrl: '/api/v1/funding',
        user: { id: 'usr-99', role: 'investor' },
        params: { id: '1' },
        query: { page: '1' },
        body: { password: 'secretpassword', amount: 100 },
        ip: '127.0.0.1',
        get: jest.fn().mockReturnValue('JestTest'),
      };
      const mockRes = { statusCode: 201 };

      const contextMock: any = {
        switchToHttp: () => ({
          getRequest: () => mockReq,
          getResponse: () => mockRes,
        }),
      };

      const callHandlerMock: any = {
        handle: () => of({ success: true }),
      };

      interceptor.intercept(contextMock, callHandlerMock).subscribe({
        next: () => {
          expect(auditServiceMock.logEvent).toHaveBeenCalledWith({
            actorId: 'usr-99',
            actorRole: 'investor',
            route: 'POST /api/v1/funding',
            statusCode: 201,
            requestDetails: {
              params: { id: '1' },
              query: { page: '1' },
              body: { password: '[REDACTED]', amount: 100 },
              ip: '127.0.0.1',
              userAgent: 'JestTest',
            },
          });
          done();
        },
      });
    });

    it('captures failed HTTP operations and logs with error details', (done) => {
      const mockReq = {
        method: 'DELETE',
        originalUrl: '/api/v1/deals/5',
        user: { id: 'usr-12', role: 'admin' },
        params: { id: '5' },
        query: {},
        body: {},
        ip: '192.168.1.1',
        get: jest.fn().mockReturnValue('JestTest'),
      };
      const mockRes = { statusCode: 500 };

      const contextMock: any = {
        switchToHttp: () => ({
          getRequest: () => mockReq,
          getResponse: () => mockRes,
        }),
      };

      const callHandlerMock: any = {
        handle: () => throwError(() => new Error('Forbidden Operation')),
      };

      interceptor.intercept(contextMock, callHandlerMock).subscribe({
        error: (err) => {
          expect(err.message).toBe('Forbidden Operation');
          expect(auditServiceMock.logEvent).toHaveBeenCalledWith(
            expect.objectContaining({
              actorId: 'usr-12',
              actorRole: 'admin',
              route: 'DELETE /api/v1/deals/5',
              statusCode: 500,
            }),
          );
          done();
        },
      });
    });
  });
});
