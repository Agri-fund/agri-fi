import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { PinoLogger } from 'nestjs-pino';
import { ClsService } from 'nestjs-cls';

export interface RequestWithCorrelationId extends Request {
  /** Unique identifier for this request — exposed on both response header and logs. */
  correlationId: string;
  /**
   * Alias for correlationId used by Pino serializers / Fluentd log collectors.
   * Both fields carry the same value so existing dashboards keep working.
   */
  traceId: string;
}

/**
 * Generates (or forwards) a trace/correlation ID for every incoming request and
 * makes it available in three places:
 *
 *  1. `req.traceId` / `req.correlationId` — consumed by pino-http serializers
 *     so every HTTP access log record includes the trace ID at the root level.
 *  2. CLS store (`traceId` + `correlationId`) — consumed by PinoLogger.assign()
 *     inside services so all non-HTTP log lines within the request scope also
 *     carry the trace ID.
 *  3. `x-trace-id` response header — allows clients / API gateways to correlate
 *     responses back to a log stream.
 *
 * Accepted inbound headers (in priority order):
 *   x-trace-id, x-correlation-id, correlation-id
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  constructor(
    private readonly logger: PinoLogger,
    private readonly cls: ClsService,
  ) {}

  use(req: RequestWithCorrelationId, res: Response, next: NextFunction): void {
    const traceId =
      (req.headers['x-trace-id'] as string) ||
      (req.headers['x-correlation-id'] as string) ||
      (req.headers['correlation-id'] as string) ||
      uuidv4();

    // Attach to request object — consumed by pino-http customProps / serializers.
    req.traceId = traceId;
    req.correlationId = traceId; // backwards-compat alias

    // Persist in CLS so PinoLogger.assign() works inside request-scoped services.
    try {
      this.cls.set('traceId', traceId);
      this.cls.set('correlationId', traceId); // backwards-compat alias
    } catch {
      // CLS context not yet established — traceId is still on req object and
      // will be picked up by pino-http's customProps callback.
    }

    // Bind the trace ID onto the Pino child logger so all log lines emitted
    // through PinoLogger within this request include traceId automatically.
    try {
      this.logger.assign({ traceId });
    } catch {
      // Outside request scope (e.g. during tests) — safe to ignore.
    }

    // Propagate as a response header so API consumers / gateways can correlate.
    res.setHeader('x-trace-id', traceId);
    // Keep the legacy header for backward compatibility.
    res.setHeader('x-correlation-id', traceId);

    next();
  }
}
