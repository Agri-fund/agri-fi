import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { PinoLogger } from 'nestjs-pino';
import { ClsService } from 'nestjs-cls'; // Added for context tracking

export interface RequestWithCorrelationId extends Request {
  correlationId: string;
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  // Inject ClsService alongside the logger
  constructor(
    private readonly logger: PinoLogger,
    private readonly cls: ClsService,
  ) {}

  use(req: RequestWithCorrelationId, res: Response, next: NextFunction) {
    const correlationId =
      (req.headers['x-correlation-id'] as string) ||
      (req.headers['correlation-id'] as string) ||
      uuidv4();

    // Attach to request object (always works)
    req.correlationId = correlationId;

    // Store in CLS if context is available (may not be during early middleware)
    try {
      this.cls.set('correlationId', correlationId);
    } catch {
      // CLS context not yet established — correlationId is still on req object
    }

    res.setHeader('x-correlation-id', correlationId);
    next();
  }
}
