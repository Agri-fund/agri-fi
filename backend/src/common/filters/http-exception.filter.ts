import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';

const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Global exception filter that:
 * - Handles both HttpException and unexpected runtime errors.
 * - In production: strips stack traces and raw database messages from 5xx
 *   responses, returning a generic "Internal Server Error" body.
 * - In development: passes full error details through for easier debugging.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const isServerError = status >= 500;

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
        : (exception instanceof Error ? exception.message : String(exception));
    }

    response.status(status).json({
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
