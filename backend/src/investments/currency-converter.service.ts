import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { FxRateService, SupportedCurrency } from '../stellar/fx-rate.service';
import {
  LocalCurrencyEquivalentDto,
  DualCurrencyAmountDto,
  FeeBreakdownWithCurrencyDto,
} from './dto/local-currency-equivalent.dto';

/**
 * Service for converting investment amounts to local currencies
 * Integrates with FxRateService to get live exchange rates
 */
@Injectable()
export class CurrencyConverterService {
  constructor(
    private readonly fxRateService: FxRateService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CurrencyConverterService.name);
  }

  /**
   * Convert USD amount to a local currency equivalent
   * Returns null if conversion fails (invalid currency, rates unavailable, etc.)
   */
  async convertToLocalEquivalent(
    usdAmount: number,
    targetCurrency?: SupportedCurrency,
  ): Promise<LocalCurrencyEquivalentDto | null> {
    if (!targetCurrency || usdAmount <= 0) {
      return null;
    }

    try {
      const rates = await this.fxRateService.getExchangeRates();
      const rate = rates[targetCurrency];

      if (!rate || rate <= 0) {
        this.logger.warn(
          { targetCurrency, rate },
          'Invalid exchange rate received',
        );
        return null;
      }

      return {
        currency: targetCurrency,
        amount: Number((usdAmount * rate).toFixed(2)),
        rate,
        rateTimestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.warn(
        { error: error instanceof Error ? error.message : String(error), targetCurrency },
        'Failed to convert amount to local currency',
      );
      return null;
    }
  }

  /**
   * Create a dual currency display format
   * Example output: "50 USDC (~6,500 KES)"
   */
  async createDualCurrencyAmount(
    usdAmount: number,
    localCurrency?: SupportedCurrency,
  ): Promise<DualCurrencyAmountDto | null> {
    if (!localCurrency) {
      return null;
    }

    const equivalent = await this.convertToLocalEquivalent(
      usdAmount,
      localCurrency,
    );
    if (!equivalent) {
      return null;
    }

    const formatted = `${usdAmount} USDC (~${equivalent.amount.toLocaleString()} ${localCurrency})`;
    const dateStr = new Date(equivalent.rateTimestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    });
    const formattedWithDisclaimer = `${formatted} - Rates updated ${dateStr} UTC`;

    return {
      usdAmount,
      localAmount: equivalent.amount,
      localCurrency: equivalent.currency,
      exchangeRate: equivalent.rate,
      formatted,
      formattedWithDisclaimer,
    };
  }

  /**
   * Create fee breakdown with local currency equivalents
   */
  async createFeeBreakdownWithCurrency(
    grossUsd: number,
    totalFeesUsd: number,
    netUsd: number,
    localCurrency?: SupportedCurrency,
  ): Promise<FeeBreakdownWithCurrencyDto> {
    const grossLocal =
      await this.convertToLocalEquivalent(grossUsd, localCurrency);
    const totalFeesLocal =
      await this.convertToLocalEquivalent(totalFeesUsd, localCurrency);
    const netLocal = await this.convertToLocalEquivalent(netUsd, localCurrency);

    return {
      grossAmountUsd: grossUsd,
      grossAmountLocal: grossLocal || undefined,
      totalFeesUsd,
      totalFeesLocal: totalFeesLocal || undefined,
      netAmountUsd: netUsd,
      netAmountLocal: netLocal || undefined,
    };
  }

  /**
   * Batch convert multiple amounts to local currency
   */
  async convertMultipleAmounts(
    amounts: Record<string, number>,
    targetCurrency?: SupportedCurrency,
  ): Promise<Record<string, number> | null> {
    if (!targetCurrency) {
      return null;
    }

    try {
      const result: Record<string, number> = {};
      for (const [key, amount] of Object.entries(amounts)) {
        const localAmount = await this.convertToLocalEquivalent(
          amount,
          targetCurrency,
        );
        if (localAmount) {
          result[key] = localAmount.amount;
        }
      }
      return Object.keys(result).length > 0 ? result : null;
    } catch (error) {
      this.logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to batch convert amounts',
      );
      return null;
    }
  }
}
