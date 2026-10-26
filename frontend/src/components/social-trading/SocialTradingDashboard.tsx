'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  MessageSquare,
  SlidersHorizontal,
  Trophy,
  Users,
} from 'lucide-react';
import { subscribeToStrategy } from '@/lib/social-trading/strategy-sharing';
import type { StrategyFeedSort } from '@/lib/social-trading/strategy-sharing';
import type { SharedStrategy } from '@/lib/social-trading/types';
import { SAMPLE_STRATEGIES } from '@/lib/social-trading/sample-data';
import { useSocialTrading } from '@/hooks/useSocialTrading';
import { useCopyTrading } from '@/hooks/useCopyTrading';
import { FollowButton } from './FollowButton';
import { TraderProfileCard } from './TraderProfileCard';
import { TraderProfileDetail } from './TraderProfileDetail';
import { LeaderboardTable } from './LeaderboardTable';
import { CopyTradingControls } from './CopyTradingControls';
import { StrategyFeed } from './StrategyFeed';
import { DiscussionForum } from './DiscussionForum';
import { CopyAnalyticsPanel } from './CopyAnalyticsPanel';

type DashboardTab = 'leaderboard' | 'profiles' | 'copy' | 'strategies' | 'discussions' | 'analytics';

const TABS: Array<{ key: DashboardTab; label: string; icon: React.ReactNode }> = [
  { key: 'leaderboard', label: 'Leaderboard', icon: <Trophy size={14} aria-hidden="true" /> },
  { key: 'profiles', label: 'Trader profiles', icon: <Users size={14} aria-hidden="true" /> },
  { key: 'copy', label: 'Copy trading', icon: <SlidersHorizontal size={14} aria-hidden="true" /> },
  { key: 'strategies', label: 'Strategies', icon: <SlidersHorizontal size={14} aria-hidden="true" /> },
  { key: 'discussions', label: 'Discussions', icon: <MessageSquare size={14} aria-hidden="true" /> },
  { key: 'analytics', label: 'Analytics', icon: <Trophy size={14} aria-hidden="true" /> },
];

export const SocialTradingDashboard: React.FC = () => {
  const social = useSocialTrading();
  const copyTrading = useCopyTrading({
    viewerId: social.viewerId,
    isTraderFollowing: social.isFollowingTrader,
  });

  const [activeTab, setActiveTab] = useState<DashboardTab>('leaderboard');
  const [selectedTraderId, setSelectedTraderId] = useState<string | null>(null);
  const [strategySort, setStrategySort] = useState<StrategyFeedSort>('hot');

  const searchParams = useSearchParams();
  const deepLinkTrader = searchParams?.get?.('trader') ?? null;

  useEffect(() => {
    if (!deepLinkTrader) return;
    if (!social.getProfile(deepLinkTrader)) return;
    setSelectedTraderId(deepLinkTrader);
    setActiveTab('profiles');
  }, [deepLinkTrader, social]);

  const selectedProfile = useMemo(
    () => (selectedTraderId ? social.getProfile(selectedTraderId) : undefined),
    [selectedTraderId, social],
  );

  const handleSelectTrader = useCallback((traderId: string) => {
    setSelectedTraderId(traderId);
    setActiveTab('profiles');
  }, []);

  const handleCopyTrader = useCallback(
    (traderId: string) => {
      copyTrading.selectTrader(traderId);
      setSelectedTraderId(traderId);
      setActiveTab('copy');
    },
    [copyTrading],
  );

  const subscribedStrategyIds = useMemo(
    () =>
      copyTrading.configs
        .filter((c) => c.derivedFromStrategyId)
        .map((c) => c.derivedFromStrategyId as string),
    [copyTrading.configs],
  );

  const handleSubscribeStrategy = useCallback(
    (strategy: SharedStrategy) => {
      const config = subscribeToStrategy(strategy, social.viewerId);
      copyTrading.applyStrategyConfig(config);
      setSelectedTraderId(strategy.authorId);
      setActiveTab('copy');
    },
    [copyTrading, social.viewerId],
  );

  const focusTrader = social.getProfile(copyTrading.traderId);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-6">
        <div>
          <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">
            Social & copy trading
          </span>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white mt-1">
            Copy the commodity traders you trust
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
            Follow verified traders, compare risk-adjusted leaderboards, configure guarded copy
            orders, share strategies and track copy performance against self-directed picks.
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 shadow-sm">
            <dt className="text-slate-500 dark:text-slate-400 font-medium">Traders you follow</dt>
            <dd className="text-xl font-black text-slate-900 dark:text-white">
              {social.followingIds.length}
            </dd>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 shadow-sm">
            <dt className="text-slate-500 dark:text-slate-400 font-medium">Active copy configs</dt>
            <dd className="text-xl font-black text-slate-900 dark:text-white">
              {copyTrading.configs.filter((c) => c.enabled).length}
            </dd>
          </div>
        </dl>
      </div>

      <div
        role="tablist"
        aria-label="Social trading sections"
        className="flex gap-2 border-b border-slate-200 dark:border-slate-800 pb-3 overflow-x-auto text-sm font-semibold"
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            id={`social-tab-${tab.key}`}
            aria-selected={activeTab === tab.key}
            aria-controls={`social-panel-${tab.key}`}
            onClick={() => setActiveTab(tab.key)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl transition whitespace-nowrap ${
              activeTab === tab.key
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'leaderboard' && (
        <div
          role="tabpanel"
          id="social-panel-leaderboard"
          aria-labelledby="social-tab-leaderboard"
          className="space-y-5"
        >
          <LeaderboardTable
            entries={social.leaderboard}
            metric={social.metric}
            window={social.window}
            onMetricChange={social.setMetric}
            onWindowChange={social.setWindow}
            region={social.region}
            regions={social.regions}
            onRegionChange={social.setRegion}
            onSelectTrader={handleSelectTrader}
            followingIds={social.followingIds}
          />
          <section
            aria-label="Suggested traders"
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm"
          >
            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2">
              Suggested traders for you
            </h3>
            <ul className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {social.suggestions.map((suggestion) => (
                <li
                  key={suggestion.traderId}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 p-3"
                >
                  <button
                    type="button"
                    onClick={() => handleSelectTrader(suggestion.traderId)}
                    aria-label={`View ${suggestion.displayName} profile`}
                    className="font-bold text-slate-900 dark:text-white text-sm hover:text-emerald-600 dark:hover:text-emerald-400 transition text-left"
                  >
                    {suggestion.displayName}
                  </button>
                  <span className="block text-[10px] text-slate-500 dark:text-slate-400 mb-1.5">
                    match score {suggestion.score}
                  </span>
                  <ul className="text-[11px] text-slate-600 dark:text-slate-300 list-disc pl-4 mb-2">
                    {suggestion.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  <FollowButton
                    traderId={suggestion.traderId}
                    displayName={suggestion.displayName}
                    following={social.isFollowingTrader(suggestion.traderId)}
                    onToggle={social.toggleFollow}
                    compact
                  />
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {activeTab === 'profiles' && (
        <div
          role="tabpanel"
          id="social-panel-profiles"
          aria-labelledby="social-tab-profiles"
          className="space-y-6"
        >
          {selectedProfile && (
            <TraderProfileDetail
              profile={selectedProfile}
              assessment={social.assessments[selectedProfile.traderId] ?? null}
              following={social.isFollowingTrader(selectedProfile.traderId)}
              onToggleFollow={social.toggleFollow}
              onCopyTrader={handleCopyTrader}
              followerCount={social.followerCountFor(selectedProfile.traderId)}
            />
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {social.profiles.map((profile) => {
              const assessment = social.assessments[profile.traderId];
              return (
                <TraderProfileCard
                  key={profile.traderId}
                  profile={profile}
                  following={social.isFollowingTrader(profile.traderId)}
                  onToggleFollow={social.toggleFollow}
                  onSelect={handleSelectTrader}
                  followerCount={social.followerCountFor(profile.traderId)}
                  riskTier={assessment?.tier ?? null}
                  riskScore={assessment?.score ?? null}
                />
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'copy' && (
        <div
          role="tabpanel"
          id="social-panel-copy"
          aria-labelledby="social-tab-copy"
          className="grid grid-cols-1 xl:grid-cols-3 gap-6"
        >
          <aside className="xl:col-span-1 space-y-4">
            <section
              aria-label="Traders with copy configs"
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm"
            >
              <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2">
                Editing copy config for
              </h3>
              <ul className="space-y-1.5">
                {social.profiles.map((profile) => (
                  <li key={profile.traderId}>
                    <button
                      type="button"
                      onClick={() => copyTrading.selectTrader(profile.traderId)}
                      aria-pressed={copyTrading.traderId === profile.traderId}
                      aria-label={`Edit copy settings for ${profile.displayName}`}
                      className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold transition ${
                        copyTrading.traderId === profile.traderId
                          ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {profile.displayName}
                      {profile.traderId === copyTrading.traderId && ' — selected'}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
                {social.isFollowingTrader(copyTrading.traderId)
                  ? 'You follow this trader, so copied orders will be planned.'
                  : 'You do not follow this trader; dry-run orders will be rejected as not following.'}
              </p>
            </section>
            <CopyAnalyticsPanel stats={copyTrading.copyStats} comparison={copyTrading.comparison} />
          </aside>
          <div className="xl:col-span-2">
            <CopyTradingControls
              config={copyTrading.config}
              fieldErrors={copyTrading.fieldErrors}
              dryRun={copyTrading.dryRun}
              onChangeConfig={copyTrading.updateConfig}
              onSave={copyTrading.saveConfig}
              onSubmitOrders={copyTrading.submitOrders}
              remainingAllowanceUsd={copyTrading.remainingAllowanceUsd}
              followingTrader={copyTrading.followingTrader}
              autoStop={copyTrading.autoStop}
              onResumeCopying={copyTrading.resumeCopying}
              traderName={focusTrader?.displayName}
            />
          </div>
        </div>
      )}

      {activeTab === 'strategies' && (
        <div
          role="tabpanel"
          id="social-panel-strategies"
          aria-labelledby="social-tab-strategies"
        >
          <StrategyFeed
            strategies={SAMPLE_STRATEGIES}
            sort={strategySort}
            onSortChange={setStrategySort}
            onSubscribe={handleSubscribeStrategy}
            subscribedStrategyIds={subscribedStrategyIds}
          />
        </div>
      )}

      {activeTab === 'discussions' && (
        <div
          role="tabpanel"
          id="social-panel-discussions"
          aria-labelledby="social-tab-discussions"
        >
          <DiscussionForum viewerId={social.viewerId} />
        </div>
      )}

      {activeTab === 'analytics' && (
        <div
          role="tabpanel"
          id="social-panel-analytics"
          aria-labelledby="social-tab-analytics"
        >
          <CopyAnalyticsPanel stats={copyTrading.copyStats} comparison={copyTrading.comparison} />
        </div>
      )}
    </div>
  );
};
