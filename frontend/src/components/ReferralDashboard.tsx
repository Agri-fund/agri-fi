'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface ReferralFunnelStep {
  stage: 'clicks' | 'signups' | 'activated';
  value: number;
  conversionRate: number;
}

export interface ReferralChannelSummary {
  channel: string;
  clicks: number;
  signups: number;
  activated: number;
  rewards: number;
  rewardRate: number;
}

export interface ReferralTimelinePoint {
  date: string;
  rewards: number;
  clicks: number;
  signups: number;
  activated: number;
}

export interface ReferralAnalytics {
  totalClicks: number;
  totalSignups: number;
  totalActivated: number;
  totalRewards: number;
  funnel: ReferralFunnelStep[];
  channels: ReferralChannelSummary[];
  timeline: ReferralTimelinePoint[];
}

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const chartColors = ['#22c55e', '#3b82f6', '#8b5cf6'];

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '0%';
  return `${value.toFixed(1)}%`;
}

function formatShortDate(date: string) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return date;
  return value.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function ReferralDashboard({
  data,
  loading = false,
}: {
  data?: ReferralAnalytics | null;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="card p-5 animate-pulse">
        <div className="h-5 w-40 bg-slate-200 rounded mb-4" />
        <div className="grid md:grid-cols-3 gap-4 mb-5">
          {[1, 2, 3].map((key) => (
            <div key={key} className="h-24 rounded-xl bg-slate-100" />
          ))}
        </div>
        <div className="h-64 rounded-xl bg-slate-100" />
      </div>
    );
  }

  const funnelData = data?.funnel ?? [];
  const rewardData = data?.timeline ?? [];
  const channelData = data?.channels ?? [];

  if (!data || funnelData.length === 0) {
    return (
      <div className="card p-8 text-center">
        <div className="w-16 h-16 rounded-3xl bg-emerald-50 flex items-center justify-center text-3xl mx-auto mb-4">
          🔗
        </div>
        <h3 className="font-bold text-slate-900 text-lg mb-2">Referral analytics are loading</h3>
        <p className="text-sm text-slate-500 max-w-md mx-auto">
          Funnel conversion and reward accrual will appear here once campaign tracking data is available.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500 mb-1">Acquisition loop</p>
          <h2 className="section-title">Referral Funnel</h2>
        </div>
        <span className="badge-green">{currency.format(data.totalRewards)} accrued</span>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-xs uppercase text-slate-400 mb-2">Clicks</p>
          <p className="text-2xl font-bold text-slate-900">{data.totalClicks}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase text-slate-400 mb-2">Signups</p>
          <p className="text-2xl font-bold text-slate-900">{data.totalSignups}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs uppercase text-slate-400 mb-2">Activated</p>
          <p className="text-2xl font-bold text-slate-900">{data.totalActivated}</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-5">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="section-title text-base">Funnel Conversion</h3>
            <span className="text-xs text-slate-400">Click → signup → activation</span>
          </div>

          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={funnelData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="stage" tick={{ fill: 'var(--chart-axis)', fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fill: 'var(--chart-axis)', fontSize: 11 }} />
              <Tooltip
                formatter={(value: number) => [value, 'Users']}
                labelFormatter={(label) => `${label}`}
              />
              <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                {funnelData.map((entry, index) => (
                  <Cell key={entry.stage} fill={chartColors[index % chartColors.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          <div className="mt-4 space-y-2">
            {funnelData.map((step) => (
              <div key={step.stage} className="flex items-center justify-between gap-3 text-sm">
                <span className="capitalize text-slate-600">{step.stage}</span>
                <div className="flex-1 flex items-center gap-2">
                  <div className="h-2 flex-1 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${Math.min(step.conversionRate, 100)}%` }}
                    />
                  </div>
                  <span className="text-slate-700 font-medium min-w-[52px] text-right">
                    {formatPercent(step.conversionRate)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="section-title text-base">Reward Accrual</h3>
            <span className="text-xs text-slate-400">USD</span>
          </div>

          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={rewardData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fill: 'var(--chart-axis)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'var(--chart-axis)', fontSize: 11 }} />
              <Tooltip
                formatter={(value: number) => [currency.format(value), 'Rewards']}
                labelFormatter={(label) => formatShortDate(String(label))}
              />
              <Line type="monotone" dataKey="rewards" stroke="#22c55e" strokeWidth={3} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="section-title text-base">Per-channel Performance</h3>
          <span className="text-xs text-slate-400">Rewards + conversion</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs uppercase text-slate-400">
                <th className="pb-3 pr-4">Channel</th>
                <th className="pb-3 pr-4">Clicks</th>
                <th className="pb-3 pr-4">Signups</th>
                <th className="pb-3 pr-4">Activated</th>
                <th className="pb-3 pr-4">Rewards</th>
                <th className="pb-3">Activation</th>
              </tr>
            </thead>
            <tbody>
              {channelData.map((row) => (
                <tr key={row.channel} className="border-t border-slate-100 text-sm text-slate-700">
                  <td className="py-3 pr-4 font-medium text-slate-900 capitalize">{row.channel}</td>
                  <td className="py-3 pr-4">{row.clicks}</td>
                  <td className="py-3 pr-4">{row.signups}</td>
                  <td className="py-3 pr-4">{row.activated}</td>
                  <td className="py-3 pr-4">{currency.format(row.rewards)}</td>
                  <td className="py-3">{formatPercent(row.rewardRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
