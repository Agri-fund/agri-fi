import { BadRequestException } from '@nestjs/common';

export const SUPPORTED_CURRENCIES = ['USD', 'GHS', 'KES', 'NGN'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/**
 * Currency conversion helpers (#1385). All amounts are stored in USD;
 * `rate` is always units of display currency per 1 USD.
 * Results are rounded half-up to 2 decimals (fiat) or 7 (XLM stroops).
 */
export class CurrencyService {
  assertSupported(code: string): SupportedCurrency {
    const upper = code?.toUpperCase();
    if (!SUPPORTED_CURRENCIES.includes(upper as SupportedCurrency)) {
      throw new BadRequestException(`Unsupported currency: ${code}`);
    }
    return upper as SupportedCurrency;
  }

  private round(value: number, decimals: number): number {
    const f = 10 ** decimals;
    return Math.round((value + Number.EPSILON) * f) / f;
  }

  private assertRate(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new BadRequestException('FX rate must be a positive number.');
    }
  }

  usdToDisplay(usd: number, rate: number): number {
    this.assertRate(rate);
    return this.round(usd * rate, 2);
  }

  displayToUsd(amount: number, rate: number): number {
    this.assertRate(rate);
    return this.round(amount / rate, 2);
  }

  /** Payouts use the USD base; XLM conversion uses the rate at release time. */
  usdToXlm(usd: number, xlmUsdRate: number): number {
    this.assertRate(xlmUsdRate);
    return this.round(usd / xlmUsdRate, 7);
  }
}
