'use client';

import React from 'react';
import { Trophy, Users } from 'lucide-react';
import type { RiskTier, TraderProfile } from '@/lib/social-trading/types';
import { FollowButton } from './FollowButton';

export interface TraderProfileCardProps {
  profile: TraderProfile;
  following: boolean;
  onToggleFollow: (traderId: string, nextFollowing: boolean) => void;
  onSelect: (traderId: string) => void;
  followerCount?: number;
  riskTier?: RiskTier | null;
  riskScore?: number | null;
}

export const TIER_BADGE_STYLES: Record<RiskTier, string> = {
  low: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/60',
  moderate: 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900/60',
  elevated: 'bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-900/60',
  high: 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-400 border-red-200 dark:border-red-900/60',
};

export function RiskTierBadge({ tier, score }: { tier: RiskTier; score?: number | null }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${TIER_BADGE_STYLES[tier]}`}
      aria-label={`Risk tier ${tier}${typeof score === 'number' ? `, score ${score}` : ''}`}
    >
      {tier}
      {typeof score === 'number' && <span className="font-semibold">{score}</span>}
    </span>
  );
}

export const TraderProfileCard: React.FC<TraderProfileCardProps> = ({
  profile,
  following,
  onToggleFollow,
  onSelect,
  followerCount,
  riskTier,
  riskScore,
}) => {
  const stats = [
    { label: 'Realised ROI', value: `${profile.metrics.realizedRoiPct}%` },
    { label: 'Sharpe', value: profile.metrics.sharpe.toFixed(2) },
    { label: 'Win rate', value: `${profile.metrics.winRatePct}%` },
    { label: 'Consistency', value: `${profile.metrics.consistencyScore}` },
  ];

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm flex flex-col justify-between hover:shadow-lg transition-all duration-200">
      <div>
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-base">
              {profile.displayName}
              {profile.verified && (
                <span className="ml-1.5 align-middle text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/60">
                  Verified
                </span>
              )}
            </h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {profile.focusSectors.join(' / ')} · {profile.regions.join(', ')}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {riskTier && <RiskTierBadge tier={riskTier} score={riskScore} />}
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
              <Users size={12} aria-hidden="true" />
              {(followerCount ?? profile.followerCount).toLocaleString()}
            </span>
          </div>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 mb-3">
          {profile.strategySummary}
        </p>

        <div className="grid grid-cols-2 gap-2 py-3 border-y border-slate-100 dark:border-slate-800/80 text-xs">
          {stats.map((stat) => (
            <div key={stat.label}>
              <span className="text-slate-500 dark:text-slate-400">{stat.label}</span>
              <p className="font-semibold text-slate-900 dark:text-white text-sm mt-0.5">{stat.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 mt-4">
        <button
          type="button"
          onClick={() => onSelect(profile.traderId)}
          aria-label={`View profile of ${profile.displayName}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
        >
          <Trophy size={13} aria-hidden="true" />
          View profile
        </button>
        <FollowButton
          traderId={profile.traderId}
          displayName={profile.displayName}
          following={following}
          onToggle={onToggleFollow}
          compact
        />
      </div>
    </div>
  );
};
