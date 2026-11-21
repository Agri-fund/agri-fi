import { BadRequestException } from '@nestjs/common';
import { CurrencyService } from './currency.service';

describe('CurrencyService', () => {
  const svc = new CurrencyService();

  it('accepts supported currencies case-insensitively', () => {
    expect(svc.assertSupported('ghs')).toBe('GHS');
  });

  it('rejects unsupported currencies', () => {
    expect(() => svc.assertSupported('EUR')).toThrow(BadRequestException);
  });

  it('rounds USD -> display half-up to 2 decimals', () => {
    expect(svc.usdToDisplay(1.005, 1)).toBe(1.01);
    expect(svc.usdToDisplay(100, 15.2)).toBe(1520);
  });

  it('converts display -> USD with rounding', () => {
    expect(svc.displayToUsd(1520, 15.2)).toBe(100);
    expect(svc.displayToUsd(10, 3)).toBe(3.33);
  });

  it('converts USD -> XLM to 7 decimals', () => {
    expect(svc.usdToXlm(1, 3)).toBe(0.3333333);
  });

  it.each([0, -1, NaN])('rejects invalid rate %p', (rate) => {
    expect(() => svc.usdToDisplay(1, rate)).toThrow(BadRequestException);
  });
});
