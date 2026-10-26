'use client';

import React, { useMemo } from 'react';
import { sortStrategyFeed } from '@/lib/social-trading/strategy-sharing';
import type { StrategyFeedSort } from '@/lib/social-trading/strategy-sharing';
import { validateStrategy } from '@/lib/social-trading/strategy-sharing';
import { SAMPLE_AS_OF } from '@/lib/social-trading/sample-data';
import type { SharedStrategy } from '@/lib/social-trading/types';
import { StrategyShareCard } from './StrategyShareCard';

export interface StrategyFeedProps {
  strategies: SharedStrategy[];
  sort: StrategyFeedSort;
  onSortChange: (sort: StrategyFeedSort) => void;
  onSubscribe: (strategy: SharedStrategy) => void;
  subscribedStrategyIds: string[];
}

const SORTS: Array<{ key: StrategyFeedSort; label: string }> = [
  { key: 'hot', label: 'Hot' },
  { key: 'recent', label: 'Recent' },
  { key: 'followers', label: 'Most subscribers' },
  { key: 'roi', label: 'Highest target ROI' },
];

export const StrategyFeed: React.FC<StrategyFeedProps> = ({
  strategies,
  sort,
  onSortChange,
  onSubscribe,
  subscribedStrategyIds,
}) => {
  const feed = useMemo(
    () => sortStrategyFeed(strategies, { by: sort, now: SAMPLE_AS_OF }),
    [strategies, sort],
  );

  return (
    <section
      aria-label="Shared strategies"
      className="space-y-4"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-slate-900 dark:text-white">Strategy feed</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Subscribing produces a ready-made copy configuration you can still edit before it trades.
          </p>
        </div>
        <div role="group" aria-label="Strategy feed sort" className="flex gap-1.5 text-xs font-semibold">
          {SORTS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => onSortChange(option.key)}
              aria-pressed={sort === option.key}
              className={`px-3 py-1.5 rounded-xl transition whitespace-nowrap ${
                sort === option.key
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {feed.map((strategy) => (
          <StrategyShareCard
            key={strategy.id}
            strategy={strategy}
            validation={validateStrategy(strategy)}
            subscribed={subscribedStrategyIds.includes(strategy.id)}
            onSubscribe={onSubscribe}
          />
        ))}
        {feed.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">No published strategies yet.</p>
        )}
      </div>
    </section>
  );
};
