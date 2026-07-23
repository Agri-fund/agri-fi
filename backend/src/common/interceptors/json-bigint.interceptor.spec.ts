import { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { JsonBigIntInterceptor } from './json-bigint.interceptor';

describe('JsonBigIntInterceptor', () => {
  let interceptor: JsonBigIntInterceptor;

  beforeEach(() => {
    interceptor = new JsonBigIntInterceptor();
  });

  const intercept = (data: unknown) => {
    const context = {} as ExecutionContext;
    const next: CallHandler = { handle: () => of(data) };
    return lastValueFrom(interceptor.intercept(context, next));
  };

  it('serializes BigInt values as strings', async () => {
    const payload = {
      fundingTarget: BigInt('9007199254740991'),
      nested: { stroops: BigInt('10000000') },
      amounts: [BigInt('1'), BigInt('2')],
    };

    const result = await intercept(payload);

    expect(result).toEqual({
      fundingTarget: '9007199254740991',
      nested: { stroops: '10000000' },
      amounts: ['1', '2'],
    });
    expect(typeof (result as { fundingTarget: unknown }).fundingTarget).toBe(
      'string',
    );
  });

  it('leaves standard number variables unchanged', async () => {
    const payload = {
      count: 42,
      price: 19.99,
      safeInteger: Number.MAX_SAFE_INTEGER,
      nested: { quantity: 0 },
      values: [1, 2, 3],
    };

    const result = await intercept(payload);

    expect(result).toEqual(payload);
    expect(typeof (result as { count: unknown }).count).toBe('number');
    expect(typeof (result as { price: unknown }).price).toBe('number');
  });
});
