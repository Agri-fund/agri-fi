import React from 'react';
import { useLocale } from 'next-intl';

type CurrencyKind = 'usd' | 'stellar';

export interface CurrencyInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'type' | 'value' | 'onChange'
  > {
  value: string;
  onChange: (value: string) => void;
  currency?: CurrencyKind;
  prefix?: string;
  suffix?: string;
}

const DECIMAL_PLACES: Record<CurrencyKind, number> = {
  usd: 2,
  stellar: 7,
};

function getDecimalPlaces(currency: CurrencyKind): number {
  return DECIMAL_PLACES[currency];
}

function sanitizeValue(value: string, decimalPlaces: number): string {
  const cleaned = value.replace(/[^0-9.]/g, '');
  if (!cleaned) {
    return '';
  }

  const [rawInteger, ...rawDecimals] = cleaned.split('.');
  const integerPart = rawInteger.replace(/^0+(?=\d)/, '') || '0';
  const decimalPart = rawDecimals.join('').slice(0, decimalPlaces);

  return cleaned.includes('.')
    ? `${integerPart}.${decimalPart}`
    : integerPart;
}

function formatForDisplay(value: string, locale: string): string {
  if (!value) {
    return '';
  }

  const [integerPart, decimalPart] = value.split('.');
  const formattedInteger = Number(integerPart || '0').toLocaleString(locale);

  if (value.endsWith('.') && decimalPart === undefined) {
    return `${formattedInteger}.`;
  }

  return decimalPart !== undefined
    ? `${formattedInteger}.${decimalPart}`
    : formattedInteger;
}

function normalizeOnBlur(value: string, decimalPlaces: number): string {
  if (!value) {
    return '';
  }

  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) {
    return '';
  }

  return numericValue.toFixed(decimalPlaces);
}

export const CurrencyInput: React.FC<CurrencyInputProps> = ({
  value,
  onChange,
  currency = 'usd',
  prefix,
  suffix,
  className = '',
  onBlur,
  ...props
}) => {
  const locale = useLocale();
  const decimalPlaces = getDecimalPlaces(currency);

  return (
    <div className="relative flex items-center">
      {prefix ? (
        <span className="pointer-events-none absolute left-4 text-sm font-medium text-neutral">
          {prefix}
        </span>
      ) : null}
      <input
        {...props}
        type="text"
        inputMode="decimal"
        value={formatForDisplay(value, locale)}
        onChange={(event) => {
          const nextValue = sanitizeValue(event.target.value, decimalPlaces);
          onChange(nextValue);
        }}
        onBlur={(event) => {
          const normalized = normalizeOnBlur(value, decimalPlaces);
          if (normalized !== value) {
            onChange(normalized);
          }
          onBlur?.(event);
        }}
        className={[
          'input',
          prefix ? 'pl-11' : '',
          suffix ? 'pr-14' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      />
      {suffix ? (
        <span className="pointer-events-none absolute right-4 text-sm font-medium text-neutral">
          {suffix}
        </span>
      ) : null}
    </div>
  );
};
