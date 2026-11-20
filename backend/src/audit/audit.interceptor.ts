import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';
import {
  auditRetentionPeriod,
  auditRetentionUntil,
  classifyAuditLog,
} from './audit-retention-policy';

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
    const action = req.method || 'GET';
    const resourceType = String(req.originalUrl || req.url || '/')
      .split('?')[0]
      .split('/')
      .filter(Boolean)
      .find((segment: string) => !['api', 'v1'].includes(segment)) ?? null;
    const resourceId = req.params?.id ? String(req.params.id) : null;
    const complianceDomain = req.user?.complianceDomain ?? null;
    const logType = classifyAuditLog(route);
    const actorId =
      req.user?.id || req.user?.sub || req.headers?.['x-actor-id'] || null;
    const actorRole =
      req.user?.role ||
      req.user?.email ||
      req.headers?.['x-actor-role'] ||
      null;

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
          void this.auditService.logEvent({
            actorId,
            actorRole,
            route,
            action,
            resourceType,
            resourceId,
            complianceDomain,
            statusCode,
            logType,
            retentionPeriod: auditRetentionPeriod(logType),
            retentionUntil: auditRetentionUntil(logType),
            requestDetails,
          });
        },
        error: (err) => {
          const statusCode = err?.status || err?.statusCode || 500;
          void this.auditService.logEvent({
            actorId,
            actorRole,
            route,
            action,
            resourceType,
            resourceId,
            complianceDomain,
            statusCode,
            logType,
            retentionPeriod: auditRetentionPeriod(logType),
            retentionUntil: auditRetentionUntil(logType),
            requestDetails: {
              ...requestDetails,
              error: err?.message || String(err),
            },
          });
        },
      }),
    );
  }

  private sanitizeBody(body: any): any {
    if (!body || typeof body !== 'object') return body;
    const clone = { ...body };
    const sensitiveKeys = [
      'password',
      'secret',
      'token',
      'privateKey',
      'authorization',
    ];
    for (const key of Object.keys(clone)) {
      if (sensitiveKeys.some((k) => key.toLowerCase().includes(k))) {
        clone[key] = '[REDACTED]';
      }
    }
    return clone;
  }
}
