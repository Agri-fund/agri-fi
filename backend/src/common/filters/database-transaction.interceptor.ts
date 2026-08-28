import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import * as Sentry from '@sentry/node';
import type { Request } from 'express';

/**
 * DatabaseTransactionInterceptor provides enhanced monitoring and error reporting
 * for database operations by attaching transaction context to Sentry events.
 *
 * When a database error occurs, it:
 * - Extracts transaction-related metadata from the request context
 * - Attaches database operation details to the Sentry scope
 * - Ensures all transaction failures are tagged appropriately
 *
 * This complements the HttpExceptionFilter by providing additional context
 * at the service layer, making it easier to correlate database failures with
 * specific operations in Sentry.
 */
@Injectable()
export class DatabaseTransactionInterceptor implements NestInterceptor {
  private readonly logger = new Logger(DatabaseTransactionInterceptor.name);

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();

    // Capture the operation being performed for better Sentry context
    const method = request.method;
    const path = request.route?.path || request.path;
    const operationId = `${method.toUpperCase()} ${path}`;

    return next.handle().pipe(
      catchError((error: unknown) => {
        // If it's a database error, enhance the Sentry context
        if (this.isDatabaseError(error)) {
          Sentry.withScope((scope) => {
            scope.setTag('transaction.operation', operationId);
            scope.setContext('database_operation', {
              method,
              path,
              timestamp: new Date().toISOString(),
            });

            // If the error has a code property (TypeORM/pg errors)
            const errorObj = error as unknown as Record<string, unknown>;
            if (errorObj.code && typeof errorObj.code === 'string') {
              scope.setTag('database.error_code', errorObj.code);
            }

            if (errorObj.detail && typeof errorObj.detail === 'string') {
              scope.setExtra('database.error_detail', errorObj.detail);
            }

            this.logger.debug(
              `Enhanced Sentry context for database error: ${operationId}`,
            );
          });
        }

        throw error;
      }),
    );
  }

  /**
   * Determines if an error originates from the database layer.
   * Uses the same patterns as HttpExceptionFilter for consistency.
   */
  private isDatabaseError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    const errorObj = error as unknown as Record<string, unknown>;

    // Check for TypeORM/pg error codes
    const code = errorObj['code'];
    if (typeof code === 'string') {
      const dbErrorCodes = new Set([
        '08000', '08003', '08006', '08001', '08004', // Connection errors
        '23000', '23001', '23502', '23503', '23505', '23514', // Integrity
        '25000', '25001', '25006', '25P01', '25P02', // Transaction
        '53300', '53400', // Resource exhaustion
      ]);
      if (dbErrorCodes.has(code)) return true;
    }

    // Check for common database error patterns
    const patterns = [
      /connection refused/i,
      /connection timeout/i,
      /ECONNREFUSED/,
      /ETIMEDOUT/,
      /ECONNRESET/,
      /database.*error/i,
      /typeorm/i,
      /QueryFailedError/i,
      /EntityNotFoundError/i,
      /query.*timeout/i,
      /transaction.*failed/i,
      /rollback/i,
    ];

    return patterns.some((pattern) => pattern.test(error.message));
  }
}
