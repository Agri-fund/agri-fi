import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import * as Sentry from '@sentry/node';

const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Error-code prefixes that identify database-layer failures.
 * TypeORM wraps pg driver errors; their codes follow the PostgreSQL SQLSTATE
 * convention (e.g. "23505" = unique_violation, "08006" = connection_failure).
 */
const DB_ERROR_CODES = new Set([
  // Connection / pool errors
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  // Integrity / constraint violations — often surface as 5xx in business logic
  '23000', // integrity_constraint_violation
  '23001', // restrict_violation
  '23502', // not_null_violation
  '23503', // foreign_key_violation
  '23505', // unique_violation
  '23514', // check_violation
  // Transaction state
  '25000', // invalid_transaction_state
  '25001', // active_sql_transaction
  '25006', // read_only_sql_transaction
  '25P01', // no_active_sql_transaction
  '25P02', // in_failed_sql_transaction
  // Too many connections / resource exhaustion
  '53300', // too_many_connections
  '53400', // configuration_limit_exceeded
  // QueryFailedError from TypeORM surfaces without a code on timeout
]);

/** Substring patterns in error messages that also indicate DB problems. */
const DB_ERROR_PATTERNS = [
  /connection refused/i,
  /connection timeout/i,
  /ECONNREFUSED/,
  /ETIMEDOUT/,
  /ECONNRESET/,
  /database.*error/i,
  /typeorm/i,
  /QueryFailedError/i,
  /EntityNotFoundError/i,
  /CannotConnectAlreadyConnectedError/i,
  /query.*timeout/i,
];

/**
 * Returns `true` when the error originates from the database layer.
 */
function isDatabaseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  // TypeORM attaches a `code` property to pg driver errors
  const code = (error as unknown as Record<string, unknown>)['code'];
  if (typeof code === 'string' && DB_ERROR_CODES.has(code)) return true;

  return DB_ERROR_PATTERNS.some((pattern) => pattern.test(error.message));
}

/**
 * Extracts lightweight context from the incoming request to attach to a Sentry
 * event.  PII-sensitive fields (raw IP, full auth header) are deliberately
 * omitted; only organisation-level identifiers are included.
 */
function buildRequestContext(request: Request): Record<string, unknown> {
  const user = (request as unknown as Record<string, unknown>)['user'] as
    | Record<string, unknown>
    | undefined;

  return {
    method: request.method,
    url: request.url,
    correlationId: request.headers['x-correlation-id'] ?? undefined,
    // Org-level identifiers from the JWT payload (set by JwtStrategy)
    userId: user?.['id'] ?? undefined,
    organizationId: user?.['organizationId'] ?? undefined,
    userRole: user?.['role'] ?? undefined,
  };
}

/**
 * Global exception filter that:
 * - Handles both HttpException and unexpected runtime errors.
 * - Routes database errors (and all 5xx non-HTTP errors) to Sentry immediately,
 *   with request/user organisation context attached.
 * - In production: strips stack traces and raw database messages from 5xx
 *   responses, returning a generic "Internal Server Error" body.
 * - In development: passes full error details through for easier debugging.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const isServerError = status >= 500;

    // ── Sentry reporting ────────────────────────────────────────────────────
    // Capture:
    //   1. All non-HTTP exceptions (unexpected runtime errors, DB failures)
    //   2. HTTP 5xx that are flagged as database errors
    const shouldCapture =
      !isHttpException ||
      (isServerError && isDatabaseError(exception)) ||
      isDatabaseError(exception);

    if (shouldCapture && exception instanceof Error) {
      const requestContext = buildRequestContext(request);

      Sentry.withScope((scope) => {
        scope.setTag('component', 'http-exception-filter');
        scope.setTag('http.status_code', String(status));

        if (isDatabaseError(exception)) {
          scope.setTag('error.type', 'database');
          scope.setLevel('error');
        }

        // Attach org-level context (no raw PII)
        scope.setContext('request', requestContext);

        if (requestContext.userId) {
          scope.setUser({
            id: String(requestContext.userId),
            // organisationId is not a standard Sentry field — add as extra
          });
          scope.setExtra('organizationId', requestContext.organizationId);
          scope.setExtra('userRole', requestContext.userRole);
        }

        Sentry.captureException(exception);
      });

      this.logger.error(
        `[Sentry] Captured exception: ${exception.message}`,
        exception.stack,
      );
    }
    // ────────────────────────────────────────────────────────────────────────

    let message: unknown;

    if (isServerError && IS_PROD) {
      message = 'Internal Server Error';
    } else if (isHttpException) {
      const exceptionResponse = exception.getResponse();
      message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : ((exceptionResponse as Record<string, unknown>).message ??
            exception.message);
    } else {
      message = IS_PROD
        ? 'Internal Server Error'
        : exception instanceof Error
          ? exception.message
          : String(exception);
    }

    response.status(status).json({
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
