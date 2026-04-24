import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { PinoLogger } from 'nestjs-pino';

export interface RequestWithCorrelationId extends Request {
  correlationId: string;
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  constructor(private readonly logger: PinoLogger) {}

  use(req: RequestWithCorrelationId, res: Response, next: NextFunction) {
    // Generate or extract correlation ID
    const correlationId =
      (req.headers['x-correlation-id'] as string) ||
      (req.headers['correlation-id'] as string) ||
      uuidv4();

    // Attach to request
    req.correlationId = correlationId;

    // Set response header for client tracking
    res.setHeader('x-correlation-id', correlationId);

    // Set correlation ID in logger context
    this.logger.assign({ correlationId });

    next();
  }
}
