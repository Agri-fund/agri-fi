'use client';

import React from 'react';
import { Bell, Users } from 'lucide-react';
import type { SharedStrategy, ValidationResult } from '@/lib/social-trading/types';

export interface StrategyShareCardProps {
  strategy: SharedStrategy;
  validation: ValidationResult;
  subscribed: boolean;
  onSubscribe: (strategy: SharedStrategy) => void;
  subscriberCount?: number;
}

const usd = (value: number) => `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export const StrategyShareCard: React.FC<StrategyShareCardProps> = ({
  strategy,
  validation,
  subscribed,
  onSubscribe,
  subscriberCount,
}) => {
  const followers = subscriberCount ?? strategy.subscriberCount;

  return (
    <article
      aria-label={`Strategy: ${strategy.title}`}
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm flex flex-col justify-between hover:shadow-lg transition-all duration-200"
    >
      <div>
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <h4 className="font-bold text-slate-900 dark:text-white text-base">{strategy.title}</h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              by {strategy.authorName} · v{strategy.version} · status {strategy.status}
            </p>
          </div>
          <span className="text-right shrink-0">
            <span className="block text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              Target ROI
            </span>
            <span className="text-xl font-black text-emerald-600 dark:text-emerald-400">
              {strategy.targetRoiPct}%
            </span>
          </span>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300 mb-2">{strategy.summary}</p>

        <div className="grid grid-cols-2 gap-2 py-2.5 border-y border-slate-100 dark:border-slate-800/80 text-xs">
          <div>
            <span className="text-slate-500 dark:text-slate-400">Allocations</span>
            <p className="font-semibold text-slate-900 dark:text-white mt-0.5">
              {strategy.allocations.map((a) => `${a.sector} ${a.weightPct}%`).join(', ')}
            </p>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-400">Regions</span>
            <p className="font-semibold text-slate-900 dark:text-white mt-0.5">
              {strategy.regions.join(', ')}
            </p>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-400">Horizon / risk bound</span>
            <p className="font-semibold text-slate-900 dark:text-white mt-0.5">
              {strategy.horizonDays} days · max risk {strategy.maxRiskScore}
            </p>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-400">Copy template</span>
            <p className="font-semibold text-slate-900 dark:text-white mt-0.5">
              {strategy.copyTemplate.mode} · {usd(strategy.copyTemplate.maxPerTrade)}/trade ·{' '}
              {usd(strategy.copyTemplate.monthlyLimit)}/month
            </p>
          </div>
        </div>

        <div className="mt-3">
          <h5 className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
            Changelog
          </h5>
          <ol className="space-y-1 text-[11px]">
            {strategy.changelog.map((entry) => (
              <li key={entry.version} className="flex gap-2">
                <span className="font-black text-slate-900 dark:text-white shrink-0">v{entry.version}</span>
                <span className="text-slate-600 dark:text-slate-300">{entry.changes}</span>
                <time className="text-slate-400 dark:text-slate-500 shrink-0" dateTime={entry.at}>
                  {entry.at.slice(0, 10)}
                </time>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {strategy.excludedCommodities.length > 0 && (
            <span className="text-[10px] font-semibold rounded-full border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-slate-600 dark:text-slate-300">
              Excludes: {strategy.excludedCommodities.join(', ')}
            </span>
          )}
          {strategy.tags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] font-semibold rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-slate-600 dark:text-slate-300"
            >
              #{tag}
            </span>
          ))}
        </div>

        <div className="mt-3" role={validation.valid ? 'status' : 'alert'}>
          {validation.valid ? (
            <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
              Strategy passes validation: allocations total 100% and the copy template stays inside
              the risk bound.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {validation.errors.map((error, index) => (
                <li key={`${error.path}:${index}`} className="text-[11px] font-semibold text-red-600 dark:text-red-400">
                  {error.path}: {error.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 mt-4">
        <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
          <Users size={13} aria-hidden="true" />
          {followers.toLocaleString()} subscribers
        </span>
        <button
          type="button"
          onClick={() => onSubscribe(strategy)}
          disabled={subscribed}
          aria-label={
            subscribed ? `Already subscribed to ${strategy.title}` : `Subscribe to ${strategy.title}`
          }
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-xl transition shadow-sm ${
            subscribed
              ? 'bg-emerald-600 text-white cursor-default'
              : 'bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900'
          }`}
        >
          <Bell size={13} aria-hidden="true" />
          {subscribed ? 'Subscribed' : 'Subscribe (creates copy config)'}
        </button>
      </div>
    </article>
  );
};
