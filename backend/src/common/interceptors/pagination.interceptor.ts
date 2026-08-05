import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
  };
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Wraps a controller's return value into a standard paginated envelope.
 * Accepts either a raw array (total = array length) or a
 * `{ data, total }` shape already produced by the service layer.
 * Opt-in via `@UseInterceptors(PaginationInterceptor)` on paginated routes.
 */
@Injectable()
export class PaginationInterceptor<T> implements NestInterceptor<
  T[] | { data: T[]; total: number },
  PaginatedResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<PaginatedResponse<T>> {
    const request = context.switchToHttp().getRequest();
    const query = request?.query ?? {};
    const page = parsePositiveInt(query.page, DEFAULT_PAGE);
    const limit = parsePositiveInt(query.limit, DEFAULT_LIMIT);

    return next.handle().pipe(
      map((result) => {
        const data = Array.isArray(result) ? result : (result?.data ?? []);
        const total = Array.isArray(result)
          ? result.length
          : (result?.total ?? data.length);

        return {
          data,
          meta: { page, limit, total },
        };
      }),
    );
  }
}
