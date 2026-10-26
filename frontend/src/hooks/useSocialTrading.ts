import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  FOLLOW_STORAGE_KEY,
  followedTraderIds,
  follow,
  isFollowing,
  loadFollowGraph,
  mutualFollows,
  saveFollowGraph,
  suggestTraders,
  unfollow,
} from '@/lib/social-trading/follow';
import type { FollowGraph, MutualFollowResult } from '@/lib/social-trading/follow';
import { buildLeaderboard } from '@/lib/social-trading/leaderboard';
import { assessCopyRisk } from '@/lib/social-trading/risk-warnings';
import { makeCopyConfig } from '@/lib/social-trading/copy-trading';
import {
  DEMO_FOLLOWER_ID,
  SAMPLE_AS_OF,
  buildSampleProfiles,
  sampleFollowGraph,
} from '@/lib/social-trading/sample-data';
import type {
  FollowRelationship,
  LeaderboardEntry,
  LeaderboardMetric,
  RiskAssessment,
  RiskTier,
  SocialMetricWindow,
  SuggestedTrader,
  TraderProfile,
} from '@/lib/social-trading/types';

const DEMO_INTERESTS = ['Cocoa', 'Coffee', 'Maize', 'West Africa'];

export const SOCIAL_WINDOWS: SocialMetricWindow[] = ['1m', '3m', '6m', '12m', 'all'];

export interface UseSocialTradingOptions {
  viewerId?: string;
  initialMetric?: LeaderboardMetric;
  initialWindow?: SocialMetricWindow;
}

export interface UseSocialTradingReturn {
  viewerId: string;
  profiles: TraderProfile[];
  getProfile: (traderId: string) => TraderProfile | undefined;
  graph: FollowGraph;
  followingIds: string[];
  isFollowingTrader: (traderId: string) => boolean;
  followTrader: (traderId: string, source?: FollowRelationship['source']) => void;
  unfollowTrader: (traderId: string) => void;
  toggleFollow: (traderId: string, nextFollowing: boolean, source?: FollowRelationship['source']) => void;
  followerCountFor: (traderId: string) => number;
  mutualFor: (traderId: string) => MutualFollowResult;
  metric: LeaderboardMetric;
  setMetric: (metric: LeaderboardMetric) => void;
  window: SocialMetricWindow;
  setWindow: (window: SocialMetricWindow) => void;
  region: string;
  setRegion: (region: string) => void;
  regions: string[];
  leaderboard: LeaderboardEntry[];
  assessments: Record<string, RiskAssessment>;
  riskScores: Record<string, { score: number; tier: RiskTier }>;
  suggestions: SuggestedTrader[];
}

export function useSocialTrading(options: UseSocialTradingOptions = {}): UseSocialTradingReturn {
  const viewerId = options.viewerId ?? DEMO_FOLLOWER_ID;

  const [graph, setGraph] = useState<FollowGraph>(() => sampleFollowGraph());
  const [metric, setMetric] = useState<LeaderboardMetric>(options.initialMetric ?? 'roi');
  const [windowKey, setWindowKey] = useState<SocialMetricWindow>(options.initialWindow ?? '12m');
  const [region, setRegion] = useState('all');

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(FOLLOW_STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (raw === null) {
      saveFollowGraph(sampleFollowGraph());
      return;
    }
    setGraph(loadFollowGraph());
  }, []);

  const profiles = useMemo(() => buildSampleProfiles(SAMPLE_AS_OF), []);

  const profileMap = useMemo(() => {
    const map = new Map<string, TraderProfile>();
    for (const profile of profiles) map.set(profile.traderId, profile);
    return map;
  }, [profiles]);

  const assessments = useMemo(() => {
    const acc: Record<string, RiskAssessment> = {};
    for (const profile of profiles) {
      acc[profile.traderId] = assessCopyRisk(
        profile,
        null,
        makeCopyConfig(viewerId, profile.traderId),
        { assessedAt: SAMPLE_AS_OF },
      );
    }
    return acc;
  }, [profiles, viewerId]);

  const riskScores = useMemo(() => {
    const acc: Record<string, { score: number; tier: RiskTier }> = {};
    for (const [traderId, assessment] of Object.entries(assessments)) {
      acc[traderId] = { score: assessment.score, tier: assessment.tier };
    }
    return acc;
  }, [assessments]);

  const leaderboard = useMemo(
    () =>
      buildLeaderboard(profiles, {
        metric,
        window: windowKey,
        region: region === 'all' ? null : region,
        riskScores,
      }),
    [profiles, metric, windowKey, region, riskScores],
  );

  const followingIds = useMemo(() => followedTraderIds(graph, viewerId), [graph, viewerId]);

  const suggestions = useMemo(
    () => suggestTraders(profiles, DEMO_INTERESTS, graph, { followerId: viewerId, limit: 3 }),
    [profiles, graph, viewerId],
  );

  const regions = useMemo(() => {
    const acc = new Set<string>();
    for (const profile of profiles) for (const r of profile.regions) acc.add(r);
    return [...acc].sort();
  }, [profiles]);

  const persist = useCallback((next: FollowGraph) => {
    setGraph(next);
    saveFollowGraph(next);
  }, []);

  const followTrader = useCallback(
    (traderId: string, source: FollowRelationship['source'] = 'profile') => {
      persist(follow(graph, viewerId, traderId, { source }));
    },
    [graph, viewerId, persist],
  );

  const unfollowTrader = useCallback(
    (traderId: string) => {
      persist(unfollow(graph, viewerId, traderId));
    },
    [graph, viewerId, persist],
  );

  const toggleFollow = useCallback(
    (traderId: string, nextFollowing: boolean, source?: FollowRelationship['source']) => {
      if (nextFollowing) followTrader(traderId, source ?? 'profile');
      else unfollowTrader(traderId);
    },
    [followTrader, unfollowTrader],
  );

  const isFollowingTrader = useCallback(
    (traderId: string) => isFollowing(graph, viewerId, traderId),
    [graph, viewerId],
  );

  const followerCountFor = useCallback(
    (traderId: string) => {
      const base = profileMap.get(traderId)?.followerCount ?? 0;
      return isFollowing(graph, viewerId, traderId) ? base + 1 : base;
    },
    [graph, profileMap, viewerId],
  );

  const mutualFor = useCallback(
    (traderId: string) => mutualFollows(graph, viewerId, traderId),
    [graph, viewerId],
  );

  const getProfile = useCallback(
    (traderId: string) => profileMap.get(traderId),
    [profileMap],
  );

  return useMemo(
    () => ({
      viewerId,
      profiles,
      getProfile,
      graph,
      followingIds,
      isFollowingTrader,
      followTrader,
      unfollowTrader,
      toggleFollow,
      followerCountFor,
      mutualFor,
      metric,
      setMetric,
      window: windowKey,
      setWindow: setWindowKey,
      region,
      setRegion,
      regions,
      leaderboard,
      assessments,
      riskScores,
      suggestions,
    }),
    [
      viewerId,
      profiles,
      getProfile,
      graph,
      followingIds,
      isFollowingTrader,
      followTrader,
      unfollowTrader,
      toggleFollow,
      followerCountFor,
      mutualFor,
      metric,
      windowKey,
      region,
      regions,
      leaderboard,
      assessments,
      riskScores,
      suggestions,
    ],
  );
}
