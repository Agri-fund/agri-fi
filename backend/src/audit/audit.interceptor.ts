import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const httpContext = context.switchToHttp();
    const req = httpContext.getRequest();
    const res = httpContext.getResponse();

    if (!req) {
      return next.handle();
    }

    const route = `${req.method || 'GET'} ${req.originalUrl || req.url || '/'}`;
    const actorId = req.user?.id || req.user?.sub || req.headers?.['x-actor-id'] || null;
    const actorRole = req.user?.role || req.user?.email || req.headers?.['x-actor-role'] || null;

    const requestDetails = {
      params: req.params ?? {},
      query: req.query ?? {},
      body: this.sanitizeBody(req.body),
      ip: req.ip || req.socket?.remoteAddress,
      userAgent: req.get ? req.get('user-agent') : req.headers?.['user-agent'],
    };

    return next.handle().pipe(
      tap({
        next: () => {
          const statusCode = res?.statusCode || 200;
          this.auditService.logEvent({
            actorId,
            actorRole,
            route,
            statusCode,
            requestDetails,
          }).catch(() => {});
        },
        error: (err) => {
          const statusCode = err?.status || err?.statusCode || 500;
          this.auditService.logEvent({
            actorId,
            actorRole,
            route,
            statusCode,
            requestDetails: {
              ...requestDetails,
              error: err?.message || String(err),
            },
          }).catch(() => {});
        },
      }),
    );
  }

  private sanitizeBody(body: any): any {
    if (!body || typeof body !== 'object') return body;
    const clone = { ...body };
    const sensitiveKeys = ['password', 'secret', 'token', 'privateKey', 'authorization'];
    for (const key of Object.keys(clone)) {
      if (sensitiveKeys.some((k) => key.toLowerCase().includes(k))) {
        clone[key] = '[REDACTED]';
      }
    }
    return clone;
  }
}
