import { useNumberFormat } from '../hooks/useNumberFormat';
import { useCurrencyFormat } from '../hooks/useCurrencyFormat';

interface Props {
  label: string;
  value: string | number;
  icon: string;
  trend?: string;
  trendUp?: boolean;
  color?: string; // tailwind bg class for icon bg
  isCurrency?: boolean;
  currency?: string;
  compact?: boolean;
}

export default function StatCard({
  label,
  value,
  icon,
  trend,
  trendUp,
  color = 'bg-brand-50',
  isCurrency = false,
  currency = 'USD',
  compact = true,
}: Props) {
  const { formatNumber } = useNumberFormat();
  const { formatCurrency } = useCurrencyFormat();

  let formattedValue: string;
  if (typeof value === 'number') {
    formattedValue = isCurrency
      ? formatCurrency(value, currency, { compact })
      : formatNumber(value, { compact });
  } else {
    formattedValue = value;
  }

  return (
    <div className="stat-card" dir="auto">
      <div className={`w-11 h-11 rounded-2xl ${color} flex items-center justify-center text-2xl flex-shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide truncate">{label}</p>
        <p className="text-2xl font-black text-slate-900 mt-0.5 tabular-nums">{formattedValue}</p>
        {trend && (
          <p className={`text-xs font-medium mt-0.5 ${trendUp ? 'text-emerald-600' : 'text-red-500'}`}>
            {trendUp ? '↑' : '↓'} {trend}
          </p>
        )}
      </div>
    </div>
  );
}
