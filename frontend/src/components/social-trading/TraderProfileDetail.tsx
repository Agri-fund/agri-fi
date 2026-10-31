'use client';

import React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { RiskAssessment, TraderProfile } from '@/lib/social-trading/types';
import { CopyRiskWarnings } from './CopyRiskWarnings';
import { FollowButton } from './FollowButton';
import { RiskTierBadge } from './TraderProfileCard';

export interface TraderProfileDetailProps {
  profile: TraderProfile;
  assessment: RiskAssessment | null;
  following: boolean;
  onToggleFollow: (traderId: string, nextFollowing: boolean) => void;
  onCopyTrader: (traderId: string) => void;
  followerCount?: number;
}

function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 280;
      const y = 80 - ((v - min) / span) * 72 - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      viewBox="0 0 280 80"
      className="w-full h-20"
      role="img"
      aria-label={label}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-emerald-600 dark:text-emerald-400"
      />
    </svg>
  );
}

export const TraderProfileDetail: React.FC<TraderProfileDetailProps> = ({
  profile,
  assessment,
  following,
  onToggleFollow,
  onCopyTrader,
  followerCount,
}) => {
  const m = profile.metrics;
  const metricRows: Array<[string, string]> = [
    ['Cumulative return', `${m.cumulativeReturnPct}%`],
    ['Annualised return', `${m.annualizedReturnPct}%`],
    ['Realised ROI', `${m.realizedRoiPct}%`],
    ['Sharpe', m.sharpe.toFixed(2)],
    ['Sortino', m.sortino.toFixed(2)],
    ['Calmar', m.calmar.toFixed(2)],
    ['Max drawdown', `${m.maxDrawdownPct}%`],
    ['Volatility (annualised)', `${m.volatilityPct}%`],
    ['Win rate', `${m.winRatePct}%`],
    ['Consistency score', `${m.consistencyScore}`],
    ['Positive periods', `${m.positivePeriodRatePct}%`],
    ['Deal default rate', `${m.defaultRatePct}%`],
    ['Avg holding days', `${m.avgHoldingDays}`],
    ['Tenure', `${m.tenureMonths} months`],
  ];

  const recentPerformance = profile.performance.slice(-6);

  return (
    <section
      aria-label={`Profile detail for ${profile.displayName}`}
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6"
    >
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <h3 className="text-2xl font-black text-slate-900 dark:text-white">
            {profile.displayName}
            {profile.verified && (
              <span className="ml-2 align-middle text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/60">
                Verified
              </span>
            )}
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 max-w-2xl">{profile.bio}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {profile.strategySummary} · Sectors: {profile.focusSectors.join(', ')} · Regions:{' '}
            {profile.regions.join(', ')} · AUM: ${profile.aumUsd.toLocaleString()} ·{' '}
            {(followerCount ?? profile.followerCount).toLocaleString()} followers
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {assessment && <RiskTierBadge tier={assessment.tier} score={assessment.score} />}
          <FollowButton
            traderId={profile.traderId}
            displayName={profile.displayName}
            following={following}
            onToggle={onToggleFollow}
            followerCount={followerCount ?? profile.followerCount}
          />
          <button
            type="button"
            onClick={() => onCopyTrader(profile.traderId)}
            aria-label={`Copy trades from ${profile.displayName}`}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-lg shadow-emerald-600/20 transition"
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            Copy this trader
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-2">
              Performance history
            </h4>
            <Sparkline values={profile.sparkline} label={`Cumulative performance sparkline for ${profile.displayName}`} />
            <table className="w-full text-xs mt-2">
              <caption className="sr-only">Recent monthly performance</caption>
              <thead>
                <tr className="text-left text-slate-500 dark:text-slate-400">
                  <th scope="col" className="py-1 pr-2 font-medium">Period</th>
                  <th scope="col" className="py-1 pr-2 font-medium">Return</th>
                  <th scope="col" className="py-1 font-medium">Cumulative</th>
                </tr>
              </thead>
              <tbody>
                {recentPerformance.map((point) => (
                  <tr key={point.period} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1 pr-2 font-semibold text-slate-900 dark:text-white">{point.period}</td>
                    <td
                      className={`py-1 pr-2 font-medium ${
                        point.returnPct >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {point.returnPct}%
                    </td>
                    <td className="py-1 text-slate-600 dark:text-slate-300">{point.cumulativePct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-2">
              Risk-adjusted metrics
            </h4>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {metricRows.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 py-1">
                  <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
                  <dd className="font-semibold text-slate-900 dark:text-white">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {assessment && (
            <div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-2">Risk factors</h4>
              <ul className="text-xs space-y-1">
                {assessment.factors.map((factor) => (
                  <li
                    key={factor.key}
                    className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 py-1"
                  >
                    <span className="text-slate-600 dark:text-slate-300">{factor.label}</span>
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {factor.subscore} (weight {Math.round(factor.weight * 100)}%)
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {assessment && <CopyRiskWarnings warnings={assessment.warnings} heading="Copy risk warnings" />}

          <div>
            <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-2">Deal portfolio</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <caption className="sr-only">Deals traded by {profile.displayName}</caption>
                <thead>
                  <tr className="text-left text-slate-500 dark:text-slate-400">
                    <th scope="col" className="py-1 pr-2 font-medium">Deal</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Commodity</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Status</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Expected ROI</th>
                    <th scope="col" className="py-1 pr-2 font-medium">Risk</th>
                    <th scope="col" className="py-1 font-medium">ESG</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.deals.map((deal) => (
                    <tr key={deal.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-1.5 pr-2 font-semibold text-slate-900 dark:text-white">
                        {deal.title ?? deal.id}
                      </td>
                      <td className="py-1.5 pr-2 text-slate-600 dark:text-slate-300">{deal.commodity}</td>
                      <td className="py-1.5 pr-2">
                        <span
                          className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            deal.status === 'failed'
                              ? 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-400'
                              : deal.status === 'open'
                                ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-400'
                                : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          {deal.status}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-slate-600 dark:text-slate-300">
                        {deal.expected_roi != null ? `${deal.expected_roi}%` : '—'}
                      </td>
                      <td className="py-1.5 pr-2 text-slate-600 dark:text-slate-300">{deal.risk_rating ?? '—'}</td>
                      <td className="py-1.5 text-slate-600 dark:text-slate-300">{deal.esg_score ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-2">Sector exposure</h4>
            <ul className="text-xs space-y-1">
              {m.exposures.map((exposure) => (
                <li
                  key={exposure.sector}
                  className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 py-1"
                >
                  <span className="text-slate-600 dark:text-slate-300">{exposure.sector}</span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {exposure.sharePct}% (${exposure.deployedUsd.toLocaleString()})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
};
