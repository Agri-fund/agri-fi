import { DatabaseTransactionInterceptor } from './database-transaction.interceptor';
import * as Sentry from '@sentry/node';
import { of, throwError } from 'rxjs';

jest.mock('@sentry/node');
const mockedSentry = Sentry as jest.Mocked<typeof Sentry>;

describe('DatabaseTransactionInterceptor', () => {
  let interceptor: DatabaseTransactionInterceptor;

  beforeEach(() => {
    jest.clearAllMocks();
    interceptor = new DatabaseTransactionInterceptor();
  });

  it('should be defined', () => {
    expect(interceptor).toBeDefined();
  });

  describe('successful requests', () => {
    it('should pass through successful responses without Sentry context', (done) => {
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'GET',
            path: '/api/test',
            route: { path: '/api/test' },
          }),
        }),
      } as any;

      const mockCallHandler = {
        handle: () => of({ success: true }),
      } as any;

      interceptor
        .intercept(mockContext, mockCallHandler)
        .subscribe({
          next: (result) => {
            expect(result).toEqual({ success: true });
            expect(mockedSentry.withScope).not.toHaveBeenCalled();
            done();
          },
        });
    });
  });

  describe('database error handling', () => {
    it('should enhance Sentry context for ECONNREFUSED errors', (done) => {
      const dbError = new Error('connect ECONNREFUSED 127.0.0.1:5432');
      const mockScope = {
        setTag: jest.fn(),
        setContext: jest.fn(),
        setExtra: jest.fn(),
      };

      (mockedSentry.withScope as jest.Mock).mockImplementation(
        (cb: (scope: any) => void) => cb(mockScope),
      );

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'POST',
            path: '/api/deals',
            route: { path: '/api/deals' },
          }),
        }),
      } as any;

      const mockCallHandler = {
        handle: () => throwError(() => dbError),
      } as any;

      interceptor
        .intercept(mockContext, mockCallHandler)
        .subscribe({
          error: (error) => {
            expect(error).toBe(dbError);
            expect(mockedSentry.withScope).toHaveBeenCalled();
            expect(mockScope.setTag).toHaveBeenCalledWith(
              'transaction.operation',
              'POST /api/deals',
            );
            expect(mockScope.setContext).toHaveBeenCalledWith(
              'database_operation',
              expect.objectContaining({
                method: 'POST',
                path: '/api/deals',
              }),
            );
            done();
          },
        });
    });

    it('should attach error code to Sentry when available', (done) => {
      const dbError = new Error('unique constraint violation');
      (dbError as any).code = '23505';
      const mockScope = {
        setTag: jest.fn(),
        setContext: jest.fn(),
        setExtra: jest.fn(),
      };

      (mockedSentry.withScope as jest.Mock).mockImplementation(
        (cb: (scope: any) => void) => cb(mockScope),
      );

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'POST',
            path: '/api/investments',
            route: { path: '/api/investments' },
          }),
        }),
      } as any;

      const mockCallHandler = {
        handle: () => throwError(() => dbError),
      } as any;

      interceptor
        .intercept(mockContext, mockCallHandler)
        .subscribe({
          error: (error) => {
            expect(error).toBe(dbError);
            expect(mockScope.setTag).toHaveBeenCalledWith(
              'database.error_code',
              '23505',
            );
            done();
          },
        });
    });

    it('should not enhance context for non-database errors', (done) => {
      const appError = new Error('Something went wrong');
      const mockScope = {
        setTag: jest.fn(),
        setContext: jest.fn(),
        setExtra: jest.fn(),
      };

      (mockedSentry.withScope as jest.Mock).mockImplementation(
        (cb: (scope: any) => void) => cb(mockScope),
      );

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'GET',
            path: '/api/test',
            route: { path: '/api/test' },
          }),
        }),
      } as any;

      const mockCallHandler = {
        handle: () => throwError(() => appError),
      } as any;

      interceptor
        .intercept(mockContext, mockCallHandler)
        .subscribe({
          error: (error) => {
            expect(error).toBe(appError);
            // Non-database errors should not trigger Sentry enhancement
            expect(mockedSentry.withScope).not.toHaveBeenCalled();
            done();
          },
        });
    });

    it('should detect QueryFailedError pattern', (done) => {
      const dbError = new Error('QueryFailedError: duplicate key value');
      const mockScope = {
        setTag: jest.fn(),
        setContext: jest.fn(),
        setExtra: jest.fn(),
      };

      (mockedSentry.withScope as jest.Mock).mockImplementation(
        (cb: (scope: any) => void) => cb(mockScope),
      );

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'PUT',
            path: '/api/users/123',
            route: { path: '/api/users/:id' },
          }),
        }),
      } as any;

      const mockCallHandler = {
        handle: () => throwError(() => dbError),
      } as any;

      interceptor
        .intercept(mockContext, mockCallHandler)
        .subscribe({
          error: (error) => {
            expect(error).toBe(dbError);
            expect(mockedSentry.withScope).toHaveBeenCalled();
            done();
          },
        });
    });
  });

  describe('request context extraction', () => {
    it('should handle requests without route information', (done) => {
      const dbError = new Error('ETIMEDOUT');
      const mockScope = {
        setTag: jest.fn(),
        setContext: jest.fn(),
        setExtra: jest.fn(),
      };

      (mockedSentry.withScope as jest.Mock).mockImplementation(
        (cb: (scope: any) => void) => cb(mockScope),
      );

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'GET',
            path: '/api/deals/123',
            route: undefined, // No route info
          }),
        }),
      } as any;

      const mockCallHandler = {
        handle: () => throwError(() => dbError),
      } as any;

      interceptor
        .intercept(mockContext, mockCallHandler)
        .subscribe({
          error: (error) => {
            expect(error).toBe(dbError);
            expect(mockScope.setTag).toHaveBeenCalledWith(
              'transaction.operation',
              'GET /api/deals/123',
            );
            done();
          },
        });
    });
  });
});
