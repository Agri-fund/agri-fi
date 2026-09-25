import { useLocale } from 'next-intl';

export interface NumberFormatOptions {
  compact?: boolean;
  decimalPlaces?: number;
  style?: 'decimal' | 'percent';
}

export function useNumberFormat() {
  const localeFromHook = useLocale();
  const locale = localeFromHook ?? 'en';

  const formatNumber = (
    value: number | string,
    options: NumberFormatOptions = {},
  ): string => {
    const numericValue = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(numericValue)) return '0';

    const decimals = options.decimalPlaces ?? (options.compact ? 1 : 2);

    const formatter = new Intl.NumberFormat(locale, {
      style: options.style ?? 'decimal',
      notation: options.compact ? 'compact' : 'standard',
      minimumFractionDigits: options.compact ? 0 : options.decimalPlaces !== undefined ? decimals : 0,
      maximumFractionDigits: decimals,
    });

    return formatter.format(numericValue);
  };

  return { formatNumber };
}
