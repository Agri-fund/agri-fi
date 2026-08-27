import { Test, TestingModule } from '@nestjs/testing';
import { JsonBigIntInterceptor } from './json-bigint.interceptor';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';

describe('JsonBigIntInterceptor - 36-digit decimal precision', () => {
  let interceptor: JsonBigIntInterceptor;

  beforeEach(() => {
    interceptor = new JsonBigIntInterceptor();
  });

  it('preserves full 7-decimal place precision for 36-digit decimal strings and bigints', (done) => {
    const mockData = {
      amountUsd: '12345678901234567890123456789.1234567',
      onChainStroops: BigInt('123456789012345678901234567891234567'),
      nested: {
        valueUsdc: '123.4567890',
      },
    };

    const context = {} as ExecutionContext;
    const next: CallHandler = {
      handle: () => of(mockData),
    };

    interceptor.intercept(context, next).subscribe((result: any) => {
      expect(result.amountUsd).toBe('12345678901234567890123456789.1234567');
      expect(result.onChainStroops).toBe('123456789012345678901234567891234567');
      expect(result.nested.valueUsdc).toBe('123.4567890');
      done();
    });
  });
});
