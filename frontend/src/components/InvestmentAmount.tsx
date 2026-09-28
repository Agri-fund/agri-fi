'use client';

import { useCurrencyConversion } from '@/hooks/useCurrencyConversion';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';

interface Props {
  usdAmount: number;
  preferredCurrency?: string;
  showDisclaimer?: boolean;
  className?: string;
}

/**
 * Displays an investment amount in USD with optional local currency equivalent
 * Example: "50 USDC (~6,500 KES)"
 */
export function InvestmentAmount({
  usdAmount,
  preferredCurrency,
  showDisclaimer = false,
  className = '',
}: Props) {
  const { convert } = useCurrencyConversion(preferredCurrency);
  const { formatCurrency } = useCurrencyFormat();

  const conversion = convert(usdAmount);

  if (!conversion) {
    return (
      <div className={className}>
        <span className="font-medium">{formatCurrency(usdAmount, 'USDC', { decimalPlaces: 2 })}</span>
      </div>
    );
  }

  return (
    <div className={className}>
      <span className="font-medium">{conversion.formatted}</span>
      {showDisclaimer && (
        <p className="text-xs text-slate-500 mt-1">{conversion.disclaimer}</p>
      )}
    </div>
  );
}

/**
 * Inline currency conversion with tooltip
 */
export function InvestmentAmountInline({
  usdAmount,
  preferredCurrency,
}: Props) {
  const { convert } = useCurrencyConversion(preferredCurrency);
  const { formatCurrency } = useCurrencyFormat();
  const conversion = convert(usdAmount);

  if (!conversion) {
    return <span>{formatCurrency(usdAmount, 'USDC', { decimalPlaces: 2 })}</span>;
  }

  return (
    <span title={conversion.disclaimer}>
      {conversion.formatted}
    </span>
  );
}
