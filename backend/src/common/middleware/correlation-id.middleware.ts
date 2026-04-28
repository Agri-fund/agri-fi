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
    // Generate or extract correlation ID
    const correlationId =
      (req.headers['x-correlation-id'] as string) ||
      (req.headers['correlation-id'] as string) ||
      uuidv4();

    // 1. Attach to request object (for legacy support)
    req.correlationId = correlationId;

    // 2. Store in AsyncLocalStorage via ClsService
    // This is what QueueService uses to grab the ID
    this.cls.set('correlationId', correlationId);

    // 3. Set response header for client tracking
    res.setHeader('x-correlation-id', correlationId);

    next();
  }
}