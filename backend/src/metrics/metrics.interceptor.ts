import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Histogram } from 'prom-client';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

// Records a request counter, an error counter and a duration histogram for every
// HTTP request, labelled by method, matched route and status code.
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(
    @InjectMetric('http_requests_total')
    private readonly requestsTotal: Counter<string>,
    @InjectMetric('http_request_errors_total')
    private readonly requestErrors: Counter<string>,
    @InjectMetric('http_request_duration_seconds')
    private readonly requestDuration: Histogram<string>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest();
    const start = process.hrtime.bigint();
    const method: string = req.method;
    // Prefer the matched route pattern over the raw URL to bound label cardinality.
    const route: string =
      req.route?.path ?? req.url?.split('?')[0] ?? 'unknown';

    const record = (statusCode: number) => {
      const labels = { method, route, status_code: String(statusCode) };
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.requestsTotal.inc(labels);
      this.requestDuration.observe(labels, seconds);
      if (statusCode >= 400) {
        this.requestErrors.inc(labels);
      }
    };

    return next.handle().pipe(
      tap({
        next: () => record(http.getResponse().statusCode),
        error: (err) => record(err?.status ?? 500),
      }),
    );
  }
}
