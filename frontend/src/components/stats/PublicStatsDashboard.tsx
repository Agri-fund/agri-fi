'use client';

import React from 'react';
import Link from 'next/link';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export interface TopCommodityStat {
  commodity: string;
  deal_count: number;
  total_volume_usd: number;
}

export interface MonthlyCapitalDeployed {
  month: string;
  label: string;
  capital_deployed_usd: number;
  deal_count: number;
}

export interface PublicStatsPayload {
  total_deals_completed: number;
  active_deals: number;
  total_capital_deployed_usd: number;
  avg_yield_pct: number;
  on_time_delivery_rate: number;
  top_5_commodities: TopCommodityStat[];
  monthly_capital_deployed: MonthlyCapitalDeployed[];
  cache_ttl_seconds: number;
  updated_at: string;
}

function formatUsd(amount: number): string {
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(2)}M`;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function PublicStatsDashboard({ stats }: { stats: PublicStatsPayload }) {
  const kpiCards = [
    {
      label: 'Total Capital Deployed',
      value: formatUsd(stats.total_capital_deployed_usd),
      subtext: 'Cumulative USDC deployed across deals',
    },
    {
      label: 'Completed Deals',
      value: stats.total_deals_completed.toLocaleString('en-US'),
      subtext: `${stats.active_deals.toLocaleString('en-US')} active deals in progress`,
    },
    {
      label: 'Average Yield',
      value: `${stats.avg_yield_pct.toFixed(1)}%`,
      subtext: 'Annualized expected ROI across active and completed deals',
    },
    {
      label: 'On-Time Delivery Rate',
      value: `${stats.on_time_delivery_rate.toFixed(1)}%`,
      subtext: 'Shipments reaching Importer milestone by target date',
    },
  ];

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 py-12 px-4 sm:px-6">
      <div className="max-w-6xl mx-auto space-y-10">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold mb-3">
              Public Platform Metrics
            </div>
            <h1 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight">
              AgriFi Performance Dashboard
            </h1>
            <p className="text-slate-600 dark:text-slate-400 mt-2 max-w-2xl">
              Aggregate trade finance performance across verified smallholder deals,
              settled transparently on the Stellar network.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/marketplace"
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors"
            >
              Browse Deals
            </Link>
            <Link
              href="/transparency"
              className="px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-sm font-semibold hover:bg-slate-100 transition-colors"
            >
              On-Chain Ledger
            </Link>
          </div>
        </header>

        {/* KPI Cards */}
        <section
          aria-label="Key performance indicators"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5"
        >
          {kpiCards.map((card) => (
            <div
              key={card.label}
              className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm"
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {card.label}
              </p>
              <p className="text-3xl font-black text-slate-900 dark:text-white mt-2 tabular-nums">
                {card.value}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                {card.subtext}
              </p>
            </div>
          ))}
        </section>

        {/* Monthly Capital Deployed Bar Chart */}
        <section className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Monthly Capital Deployed (Last 12 Months)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                USD value of confirmed and completed investments per calendar month
              </p>
            </div>
            <span className="text-xs text-slate-400">
              Updated {new Date(stats.updated_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </span>
          </div>

          <div className="h-80 w-full" data-testid="monthly-capital-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={stats.monthly_capital_deployed}
                margin={{ top: 10, right: 16, left: 8, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: '#64748b' }}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(value: number) =>
                    value >= 1000 ? `$${Math.round(value / 1000)}k` : `$${value}`
                  }
                  tick={{ fontSize: 12, fill: '#64748b' }}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(value: number) => [
                    formatUsd(Number(value)),
                    'Capital Deployed',
                  ]}
                />
                <Bar
                  dataKey="capital_deployed_usd"
                  name="Capital Deployed (USD)"
                  fill="#059669"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Top 5 Commodities */}
        <section className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">
            Top 5 Commodities by Volume
          </h2>
          {stats.top_5_commodities.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">
              No commodity volume data available yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="border-b border-slate-200 dark:border-slate-800 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-3 pr-4">Rank</th>
                    <th className="py-3 pr-4">Commodity</th>
                    <th className="py-3 pr-4">Deals</th>
                    <th className="py-3 text-right">Total Volume (USD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {stats.top_5_commodities.map((item, idx) => (
                    <tr key={item.commodity}>
                      <td className="py-3 pr-4 font-semibold text-slate-500">
                        #{idx + 1}
                      </td>
                      <td className="py-3 pr-4 font-semibold text-slate-900 dark:text-white">
                        {item.commodity}
                      </td>
                      <td className="py-3 pr-4 text-slate-600 dark:text-slate-300">
                        {item.deal_count.toLocaleString('en-US')}
                      </td>
                      <td className="py-3 text-right font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                        {formatUsd(item.total_volume_usd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default PublicStatsDashboard;
