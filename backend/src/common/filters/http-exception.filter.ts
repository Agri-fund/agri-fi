import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  ValidationError,
} from '@nestjs/common';
import type { Request, Response } from 'express';

const IS_PROD = process.env.NODE_ENV === 'production';

export interface CanonicalErrorResponse {
  statusCode: number;
  error: string;
  message: string;
  field?: string;
  path: string;
  timestamp: string;
  errors?: string[];
}

/**
 * Global exception filter that:
 * - Normalizes all validation and domain errors into a canonical structured error shape (#964)
 * - Handles both HttpException and unexpected runtime errors.
 * - In production: strips stack traces and raw database messages from 5xx
 *   responses, returning a generic "Internal Server Error" body.
 * - In development: passes full error details through for easier debugging.
 * - Formats validation errors into a structured errors array.
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

    let message: string;
    let errors: string[] = [];
    let errorCode: string = HttpStatus[status] ?? 'ERROR';
    let field: string | undefined = undefined;

    if (isServerError && IS_PROD) {
      message = 'Internal Server Error';
      errorCode = 'INTERNAL_SERVER_ERROR';
      // Log stack trace internally for server errors in production
      if (exception instanceof Error) {
        console.error('[HttpExceptionFilter] Server Error:', exception.stack);
      }
    } else if (isHttpException) {
      const exceptionResponse = exception.getResponse();
      const responseObj =
        typeof exceptionResponse === 'string'
          ? { message: exceptionResponse }
          : (exceptionResponse as Record<string, unknown>);

      message =
        (typeof responseObj.message === 'string'
          ? responseObj.message
          : exception.message) || 'Request failed';

      // Handle custom or domain structured error codes (#964)
      if (
        responseObj.error === 'INVALID_WALLET_ADDRESS' ||
        responseObj.code === 'INVALID_WALLET_ADDRESS'
      ) {
        errorCode = 'INVALID_WALLET_ADDRESS';
        field = (responseObj.field as string) || 'walletAddress';
      } else if (Array.isArray(responseObj.message)) {
        errors = this.flattenValidationErrors(responseObj.message);
        message = 'Validation failed';
        errorCode = 'VALIDATION_ERROR';
      } else if (typeof responseObj.error === 'string') {
        errorCode = responseObj.error;
      } else if (typeof responseObj.code === 'string') {
        errorCode = responseObj.code;
      }

      if (responseObj.field && typeof responseObj.field === 'string') {
        field = responseObj.field;
      }
    } else {
      message = IS_PROD
        ? 'Internal Server Error'
        : exception instanceof Error
          ? exception.message
          : String(exception);
      errorCode = 'INTERNAL_SERVER_ERROR';
    }

    const payload: CanonicalErrorResponse = {
      statusCode: status,
      error: errorCode,
      message,
      field,
      path: request.url,
      timestamp: new Date().toISOString(),
      errors: errors.length > 0 ? errors : undefined,
    };

    response.status(status).json(payload);
  }

  private flattenValidationErrors(validationErrors: unknown[]): string[] {
    const errors: string[] = [];

    for (const error of validationErrors) {
      if (typeof error === 'string') {
        errors.push(error);
      } else if (this.isValidationError(error)) {
        const constraints = error.constraints;
        if (constraints) {
          errors.push(...Object.values(constraints));
        }
        const children = error.children;
        if (children && children.length > 0) {
          errors.push(...this.flattenValidationErrors(children));
        }
      }
    }

    return errors;
  }

  private isValidationError(error: unknown): error is ValidationError {
    return (
      typeof error === 'object' && error !== null && 'constraints' in error
    );
  }
}
