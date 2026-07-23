'use client';

import React from 'react';

interface MetricCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: {
    value: string;
    isPositive?: boolean;
  };
  subtext?: string;
  loading?: boolean;
  colorTheme?: 'emerald' | 'blue' | 'amber' | 'purple';
}

const THEMES = {
  emerald: {
    iconBg: 'bg-emerald-50 text-emerald-600 ring-emerald-100/80',
    borderHover: 'hover:border-emerald-200/80',
    shadowGlow: 'hover:shadow-emerald-100/40',
    barGradient: 'from-emerald-500 to-teal-500',
  },
  blue: {
    iconBg: 'bg-blue-50 text-blue-600 ring-blue-100/80',
    borderHover: 'hover:border-blue-200/80',
    shadowGlow: 'hover:shadow-blue-100/40',
    barGradient: 'from-blue-500 to-indigo-500',
  },
  amber: {
    iconBg: 'bg-amber-50 text-amber-600 ring-amber-100/80',
    borderHover: 'hover:border-amber-200/80',
    shadowGlow: 'hover:shadow-amber-100/40',
    barGradient: 'from-amber-500 to-orange-500',
  },
  purple: {
    iconBg: 'bg-purple-50 text-purple-600 ring-purple-100/80',
    borderHover: 'hover:border-purple-200/80',
    shadowGlow: 'hover:shadow-purple-100/40',
    barGradient: 'from-purple-500 to-violet-500',
  },
};

export default function MetricCard({
  label,
  value,
  icon,
  trend,
  subtext,
  loading = false,
  colorTheme = 'emerald',
}: MetricCardProps) {
  const theme = THEMES[colorTheme];

  if (loading) {
    return (
      <div className="card p-6 flex flex-col gap-4 relative overflow-hidden h-[135px]">
        {/* Shimmer line */}
        <div className="absolute top-0 left-0 w-full h-[3px] bg-slate-100 skeleton" />
        <div className="flex items-center justify-between">
          <div className="h-4 w-28 skeleton rounded" />
          <div className="w-10 h-10 rounded-xl skeleton flex-shrink-0" />
        </div>
        <div className="space-y-2 mt-auto">
          <div className="h-7 w-20 skeleton rounded" />
          <div className="h-3 w-36 skeleton rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className={`card p-6 flex flex-col justify-between relative overflow-hidden transition-all duration-300 hover:shadow-card-md hover:-translate-y-0.5 ${theme.borderHover} ${theme.shadowGlow} group h-[135px]`}>
      {/* Decorative Top Accent Bar */}
      <div className={`absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r ${theme.barGradient} opacity-80 group-hover:opacity-100 transition-opacity`} />
      
      <div className="flex items-start justify-between">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          {label}
        </span>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ring-4 transition-transform duration-300 group-hover:scale-110 ${theme.iconBg}`}>
          {icon}
        </div>
      </div>

      <div className="mt-2">
        <h3 className="text-2xl font-black text-slate-900 tracking-tight tabular-nums">
          {value}
        </h3>
        
        <div className="flex items-center gap-1.5 mt-1 min-h-[16px]">
          {trend && (
            <span className={`inline-flex items-center text-xs font-bold leading-none ${
              trend.isPositive ? 'text-emerald-600' : 'text-red-500'
            }`}>
              {trend.isPositive ? '↑' : '↓'} {trend.value}
            </span>
          )}
          {subtext && (
            <span className="text-xs font-medium text-slate-400 truncate">
              {subtext}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
