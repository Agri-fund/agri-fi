import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { PaginationInterceptor } from './pagination.interceptor';

describe('PaginationInterceptor', () => {
  let interceptor: PaginationInterceptor<unknown>;

  beforeEach(() => {
    interceptor = new PaginationInterceptor();
  });

  const intercept = (data: unknown, query: Record<string, unknown> = {}) => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ query }),
      }),
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of(data) };
    return lastValueFrom(interceptor.intercept(context, next));
  };

  it('applies default page and limit when none are provided', async () => {
    const result = await intercept([1, 2, 3]);

    expect(result).toEqual({
      data: [1, 2, 3],
      meta: { page: 1, limit: 10, total: 3 },
    });
  });

  it('parses page and limit from the request query', async () => {
    const result = await intercept([1, 2], { page: '2', limit: '5' });

    expect(result.meta).toEqual({ page: 2, limit: 5, total: 2 });
  });

  it('falls back to defaults for invalid page/limit values', async () => {
    const result = await intercept([1], { page: '0', limit: 'abc' });

    expect(result.meta).toEqual({ page: 1, limit: 10, total: 1 });
  });

  it('preserves an already-computed total when the service returns { data, total }', async () => {
    const result = await intercept({ data: [1, 2], total: 42 });

    expect(result).toEqual({
      data: [1, 2],
      meta: { page: 1, limit: 10, total: 42 },
    });
  });
});
