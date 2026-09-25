import { useLocale } from 'next-intl';

export interface CurrencyFormatOptions {
  compact?: boolean;
  decimalPlaces?: number;
  displayIso?: boolean;
}

const FIAT_CURRENCIES = ['USD', 'EUR', 'KES', 'GBP', 'BRL', 'CAD', 'AUD', 'JPY'];

export function useCurrencyFormat() {
  const localeFromHook = useLocale();
  const locale = localeFromHook ?? 'en';

  const formatCurrency = (
    amount: number | string,
    currency: string = 'USD',
    options: CurrencyFormatOptions = {},
  ): string => {
    const numericValue = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(numericValue)) return `0 ${currency.toUpperCase()}`;

    const uppercaseCurrency = currency.toUpperCase();
    const isFiat = FIAT_CURRENCIES.includes(uppercaseCurrency);
    const defaultDecimals = isFiat ? 2 : 7;
    const decimals = options.decimalPlaces ?? defaultDecimals;
    const displayIso = options.displayIso ?? true;

    if (isFiat) {
      const formatter = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: uppercaseCurrency,
        notation: options.compact ? 'compact' : 'standard',
        minimumFractionDigits: options.compact ? 0 : decimals,
        maximumFractionDigits: decimals,
      });
      const formatted = formatter.format(numericValue);

      if (displayIso && !formatted.includes(uppercaseCurrency)) {
        return `${formatted} ${uppercaseCurrency}`;
      }
      return formatted;
    } else {
      // Crypto / USDC / Custom tokens
      const formatter = new Intl.NumberFormat(locale, {
        style: 'decimal',
        notation: options.compact ? 'compact' : 'standard',
        minimumFractionDigits: options.compact ? 0 : decimals,
        maximumFractionDigits: decimals,
      });
      return `${formatter.format(numericValue)} ${uppercaseCurrency}`;
    }
  };

  return { formatCurrency };
}
