'use client';

import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, TooltipProps } from 'recharts';
import type { DealAllocation } from '../../lib/api';

interface PortfolioAllocationChartProps {
  allocations: DealAllocation[];
  loading?: boolean;
  className?: string;
}

// A small categorical palette, distinguishable in both light and dark themes.
// Local to this chart rather than a global CSS variable set — this is the
// only place in the app that currently needs more than one series color.
const SLICE_COLORS = [
  '#16a34a', // brand green
  '#2563eb',
  '#d97706',
  '#7c3aed',
  '#dc2626',
  '#0891b2',
  '#65a30d',
  '#db2777',
];

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function AllocationTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const entry = payload[0]?.payload as DealAllocation | undefined;
  if (!entry) return null;

  return (
    <div className="portfolio-chart-tooltip">
      <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{entry.commodity}</p>
      <p className="text-xs text-slate-500 tabular-nums mt-0.5">
        {currency.format(entry.amountUsd)} · {entry.percentage.toFixed(1)}%
      </p>
    </div>
  );
}

/**
 * Donut chart showing how an investor's committed capital is split across
 * their currently-held deals (#789). Expects `allocations` sorted by
 * `amountUsd` descending — see `GET /investments/summary`.
 */
export default function PortfolioAllocationChart({
  allocations,
  loading = false,
  className = '',
}: PortfolioAllocationChartProps) {
  const data = useMemo(() => allocations.filter((a) => a.amountUsd > 0), [allocations]);

  if (loading) {
    return (
      <div className={`card p-5 ${className}`}>
        <div className="h-4 w-40 skeleton rounded mb-6" />
        <div className="h-64 w-full skeleton rounded-full mx-auto max-w-[240px]" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div
        className={`card p-8 flex flex-col items-center justify-center text-center gap-2 h-[320px] ${className}`}
      >
        <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-2xl">
          🥧
        </div>
        <p className="text-sm font-semibold text-slate-700">No allocation yet</p>
        <p className="text-xs text-slate-400 max-w-[220px]">
          Once you hold a live position in a deal, its share of your portfolio will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className={`card p-5 ${className}`}>
      <h3 className="section-title text-base mb-1">Allocation by Deal</h3>
      <div className="flex flex-col md:flex-row items-center gap-4">
        <ResponsiveContainer width="100%" height={220} className="max-w-[220px]">
          <PieChart>
            <Pie
              data={data}
              dataKey="amountUsd"
              nameKey="commodity"
              innerRadius={55}
              outerRadius={90}
              paddingAngle={2}
              isAnimationActive
            >
              {data.map((entry, index) => (
                <Cell key={entry.dealId} fill={SLICE_COLORS[index % SLICE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<AllocationTooltip />} />
          </PieChart>
        </ResponsiveContainer>

        <ul className="flex-1 w-full space-y-2">
          {data.map((entry, index) => (
            <li key={entry.dealId} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: SLICE_COLORS[index % SLICE_COLORS.length] }}
                  aria-hidden="true"
                />
                <span className="font-medium text-slate-700 truncate">{entry.commodity}</span>
              </span>
              <span className="text-slate-400 font-semibold tabular-nums flex-shrink-0">
                {entry.percentage.toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
