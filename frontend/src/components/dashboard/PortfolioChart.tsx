'use client';

import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  TooltipProps,
} from 'recharts';

export interface PortfolioHistoryPoint {
  /** ISO date string */
  date: string;
  /** Portfolio value (USD) at that date */
  value: number;
}

interface PortfolioChartProps {
  /**
   * Raw history payload from the API. Accepts a loose shape so callers don't
   * need to pre-normalize field names — see `formatPortfolioHistory`.
   */
  data: unknown;
  loading?: boolean;
  className?: string;
}

/**
 * Normalizes a raw API history response into a sorted coordinates array.
 * Tolerates a few common field-naming conventions (snake_case / camelCase)
 * and silently drops entries that can't be parsed into a valid point.
 */
export function formatPortfolioHistory(raw: unknown): PortfolioHistoryPoint[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry): PortfolioHistoryPoint | null => {
      if (!entry || typeof entry !== 'object') return null;
      const record = entry as Record<string, unknown>;

      const rawDate =
        record.date ?? record.recordedAt ?? record.recorded_at ??
        record.timestamp ?? record.createdAt ?? record.created_at;
      const rawValue =
        record.value ?? record.portfolioValue ?? record.portfolio_value ??
        record.totalValue ?? record.total_value ?? record.amount;

      if (rawDate == null || rawValue == null) return null;

      const date = new Date(rawDate as string | number);
      const value = Number(rawValue);
      if (Number.isNaN(date.getTime()) || !Number.isFinite(value)) return null;

      return { date: date.toISOString(), value };
    })
    .filter((point): point is PortfolioHistoryPoint => point !== null)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const currencyCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

function formatAxisDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function formatFullDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value;
  if (typeof value !== 'number') return null;

  return (
    <div className="portfolio-chart-tooltip">
      <p className="text-sm font-bold text-slate-900 dark:text-slate-100 tabular-nums">
        {currency.format(value)}
      </p>
      <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
        <span className="inline-block w-2.5 h-0.5 rounded-full" style={{ backgroundColor: 'var(--chart-line)' }} />
        {formatFullDate(String(label))}
      </p>
    </div>
  );
}

export default function PortfolioChart({ data, loading = false, className = '' }: PortfolioChartProps) {
  const points = useMemo(() => formatPortfolioHistory(data), [data]);

  if (loading) {
    return (
      <div className={`card p-5 ${className}`}>
        <div className="h-4 w-40 skeleton rounded mb-6" />
        <div className="h-64 w-full skeleton rounded-xl" />
      </div>
    );
  }

  if (points.length < 2) {
    return (
      <div className={`card p-8 flex flex-col items-center justify-center text-center gap-2 h-[320px] ${className}`}>
        <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-2xl">
          📈
        </div>
        <p className="text-sm font-semibold text-slate-700">Not enough history yet</p>
        <p className="text-xs text-slate-400 max-w-[220px]">
          {points.length === 1
            ? `Your current portfolio value is ${currency.format(points[0].value)}. Check back after your next investment to see a trend.`
            : 'Once you have investment activity, your portfolio trend will appear here.'}
        </p>
      </div>
    );
  }

  return (
    <div className={`portfolio-chart card p-5 ${className}`}>
      <div className="flex items-center justify-between mb-1">
        <h3 className="section-title text-base">Portfolio Value</h3>
        <span className="text-xs font-semibold text-slate-400">
          {formatAxisDate(points[0].date)} – {formatAxisDate(points[points.length - 1].date)}
        </span>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={points} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="portfolioValueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-line)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--chart-line)" stopOpacity={0.01} />
            </linearGradient>
          </defs>

          <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeWidth={1} />

          <XAxis
            dataKey="date"
            tickFormatter={formatAxisDate}
            tick={{ fill: 'var(--chart-axis)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={32}
          />
          <YAxis
            tickFormatter={(v: number) => currencyCompact.format(v)}
            tick={{ fill: 'var(--chart-axis)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={56}
          />

          <Tooltip
            content={<ChartTooltip />}
            cursor={{ stroke: 'var(--chart-axis)', strokeWidth: 1 }}
          />

          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--chart-line)"
            strokeWidth={2}
            fill="url(#portfolioValueFill)"
            activeDot={{ r: 4, stroke: 'var(--chart-line)', strokeWidth: 2, fill: 'white' }}
            dot={false}
            isAnimationActive
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
