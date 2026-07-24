import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime();

    res.on('finish', () => {
      const [seconds, nanoseconds] = process.hrtime(start);
      const durationMs = (seconds * 1000 + nanoseconds / 1e6).toFixed(1);
      const userAgent = req.headers['user-agent'] || '-';

      this.logger.log(
        `[HTTP] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms - ${userAgent}`,
      );
    });

    next();
  }
}
