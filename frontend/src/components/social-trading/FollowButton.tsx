'use client';

import React from 'react';
import { UserCheck, UserPlus } from 'lucide-react';

export interface FollowButtonProps {
  traderId: string;
  displayName: string;
  following: boolean;
  onToggle: (traderId: string, nextFollowing: boolean) => void;
  followerCount?: number;
  followingCount?: number;
  compact?: boolean;
}

export const FollowButton: React.FC<FollowButtonProps> = ({
  traderId,
  displayName,
  following,
  onToggle,
  followerCount,
  followingCount,
  compact = false,
}) => {
  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        aria-pressed={following}
        aria-label={following ? `Unfollow ${displayName}` : `Follow ${displayName}`}
        onClick={() => onToggle(traderId, !following)}
        className={`inline-flex items-center gap-1.5 rounded-xl font-bold transition shadow-sm ${
          compact ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-1.5 text-xs'
        } ${
          following
            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
            : 'border border-emerald-600 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40'
        }`}
      >
        {following ? <UserCheck size={14} aria-hidden="true" /> : <UserPlus size={14} aria-hidden="true" />}
        {following ? 'Following' : 'Follow'}
      </button>
      {typeof followerCount === 'number' && (
        <span
          className="text-[11px] text-slate-500 dark:text-slate-400"
          aria-label={`${followerCount.toLocaleString()} followers`}
        >
          {followerCount.toLocaleString()} followers
        </span>
      )}
      {typeof followingCount === 'number' && (
        <span
          className="text-[11px] text-slate-500 dark:text-slate-400"
          aria-label={`${followingCount.toLocaleString()} followed`}
        >
          {followingCount.toLocaleString()} following
        </span>
      )}
    </div>
  );
};
