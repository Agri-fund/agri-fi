import { useTranslations, useFormatter, useLocale } from 'next-intl';

interface FundingProgressBarProps {
  totalValue: number;
  totalInvested: number;
}

export default function FundingProgressBar({ totalValue, totalInvested }: FundingProgressBarProps) {
  const t = useTranslations('deals');
  const format = useFormatter();
  const locale = useLocale();
  const pct = totalValue > 0 ? Math.min((totalInvested / totalValue) * 100, 100) : 0;
  const remaining = Math.max(totalValue - totalInvested, 0);

  return (
    <div className="w-full space-y-1.5">
      <div className="flex justify-between text-xs font-medium">
        <span className="text-slate-500">
          {t('raised', {
            amount: format.number(totalInvested, { style: 'currency', currency: 'USD' })
          })}
        </span>
        <span className="text-brand-600 font-bold">{format.number(pct, { maximumFractionDigits: 1 })}%</span>
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
          remaining: format.number(remaining, { style: 'currency', currency: 'USD' }),
          total: format.number(totalValue, { style: 'currency', currency: 'USD' })
        })}
      </p>
    </div>
  );
}
