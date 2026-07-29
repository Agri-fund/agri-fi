import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { createHash } from 'crypto';

/**
 * Interceptor that generates ETag headers for GET requests and
 * returns 304 Not Modified when client If-None-Match header matches.
 * Issue #747 — ETag Support for Static Configurations
 */
@Injectable()
export class ETagInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();

    if (req.method !== 'GET') {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        if (data === undefined || data === null) {
          return data;
        }

        const bodyString =
          typeof data === 'object' ? JSON.stringify(data) : String(data);
        const hash = createHash('md5').update(bodyString).digest('hex');
        const etag = `W/"${hash}"`;

        res.setHeader('ETag', etag);
        res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');

        const ifNoneMatch = req.headers['if-none-match'];
        if (
          ifNoneMatch &&
          (ifNoneMatch === etag || ifNoneMatch.includes(hash))
        ) {
          res.status(304);
          return null;
        }

        return data;
      }),
    );
  }
}
