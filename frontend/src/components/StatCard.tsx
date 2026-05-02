interface Props {
  label: string;
  value: string | number;
  icon: string;
  trend?: string;
  trendUp?: boolean;
  color?: string; // tailwind bg class for icon bg
}

export default function StatCard({ label, value, icon, trend, trendUp, color = 'bg-brand-50' }: Props) {
  return (
    <div className="stat-card">
      <div className={`w-11 h-11 rounded-2xl ${color} flex items-center justify-center text-2xl flex-shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide truncate">{label}</p>
        <p className="text-2xl font-black text-slate-900 mt-0.5 tabular-nums">{value}</p>
        {trend && (
          <p className={`text-xs font-medium mt-0.5 ${trendUp ? 'text-emerald-600' : 'text-red-500'}`}>
            {trendUp ? '↑' : '↓'} {trend}
          </p>
        )}
      </div>
    </div>
  );
}
