'use client';

interface Props {
  label: string;
  usdValue: number;
  icon: string;
  trend?: string;
  trendUp?: boolean;
  color?: string;
  localCurrency?: string;
  localValue?: number;
  rateDisclaimer?: string;
}

/**
 * StatCard that displays amounts in both USD and a local currency
 * Format: "50 USDC (~6,500 KES)"
 */
export default function DualCurrencyStatCard({
  label,
  usdValue,
  icon,
  trend,
  trendUp,
  color = 'bg-brand-50',
  localCurrency,
  localValue,
  rateDisclaimer,
}: Props) {
  const showLocal = localCurrency && localValue !== undefined;

  const displayValue = showLocal
    ? `${usdValue.toLocaleString()} USDC (~${localValue.toLocaleString()} ${localCurrency})`
    : `${usdValue.toLocaleString()} USDC`;

  return (
    <div className="stat-card">
      <div
        className={`w-11 h-11 rounded-2xl ${color} flex items-center justify-center text-2xl flex-shrink-0`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide truncate">
          {label}
        </p>
        <p className="text-lg font-black text-slate-900 mt-0.5 tabular-nums break-words">
          {displayValue}
        </p>
        {rateDisclaimer && showLocal && (
          <p className="text-xs text-slate-400 mt-1">{rateDisclaimer}</p>
        )}
        {trend && (
          <p
            className={`text-xs font-medium mt-1 ${
              trendUp ? 'text-emerald-600' : 'text-red-500'
            }`}
          >
            {trendUp ? '↑' : '↓'} {trend}
          </p>
        )}
      </div>
    </div>
  );
}
