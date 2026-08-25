import { useTranslations } from 'next-intl';
import { useCurrencyFormat } from '../hooks/useCurrencyFormat';
import { useNumberFormat } from '../hooks/useNumberFormat';

interface FundingProgressBarProps {
  totalValue: number;
  totalInvested: number;
  currency?: string;
}

export default function FundingProgressBar({
  totalValue,
  totalInvested,
  currency = 'USD',
}: FundingProgressBarProps) {
  const t = useTranslations('deals');
  const { formatCurrency } = useCurrencyFormat();
  const { formatNumber } = useNumberFormat();

  const pct = totalValue > 0 ? Math.min((totalInvested / totalValue) * 100, 100) : 0;
  const remaining = Math.max(totalValue - totalInvested, 0);

  return (
    <div className="w-full space-y-1.5" dir="auto">
      <div className="flex justify-between text-xs font-medium">
        <span className="text-slate-500">
          {t('raised', {
            amount: formatCurrency(totalInvested, currency),
          })}
        </span>
        <span className="text-brand-600 font-bold">
          {formatNumber(pct, { decimalPlaces: 1 })}%
        </span>
      </div>
      <div className="progress-track">
        <div
          className="progress-green"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <p className="text-xs text-slate-400">
        {t('remainingOf', {
          remaining: formatCurrency(remaining, currency),
          total: formatCurrency(totalValue, currency),
        })}
      </p>
    </div>
  );
}
