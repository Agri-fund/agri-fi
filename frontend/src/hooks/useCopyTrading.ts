import { useCallback, useMemo, useState } from 'react';

import {
  applyCopyOrders,
  clearAutoStop,
  evaluateAutoStop,
  loadCopyConfigs,
  makeCopyConfig,
  remainingAllowance,
  saveCopyConfigs,
  simulateCopyWindow,
  upsertCopyConfig,
  validateCopyConfig,
} from '@/lib/social-trading/copy-trading';
import { aggregate, compareCopyVsOrganic } from '@/lib/social-trading/copy-analytics';
import {
  DEMO_FOLLOWER_ID,
  SAMPLE_COPY_CONFIGS,
  SAMPLE_COPY_RESULTS,
  SAMPLE_LEADER_TRADES,
  SAMPLE_ORGANIC_RESULTS,
  demoPortfolio,
} from '@/lib/social-trading/sample-data';
import type {
  AutoStopState,
  CopyConfig,
  CopyOrder,
  CopyRejection,
  CopyTradeEvent,
  FieldError,
  PortfolioState,
  SimulationResult,
} from '@/lib/social-trading/types';

export interface UseCopyTradingOptions {
  viewerId?: string;
  initialTraderId?: string;
  isTraderFollowing?: (traderId: string) => boolean;
}

export interface CopyAutoStopStatus extends AutoStopState {
  reason: string | null;
}

export interface UseCopyTradingReturn {
  viewerId: string;
  configs: CopyConfig[];
  traderId: string;
  config: CopyConfig;
  fieldErrors: FieldError[];
  isConfigValid: boolean;
  trades: CopyTradeEvent[];
  portfolio: PortfolioState;
  remainingAllowanceUsd: number;
  dryRun: SimulationResult;
  plannedOrders: CopyOrder[];
  rejections: CopyRejection[];
  autoStop: CopyAutoStopStatus;
  followingTrader: boolean;
  selectTrader: (traderId: string) => void;
  updateConfig: (patch: Partial<CopyConfig>) => void;
  applyStrategyConfig: (next: CopyConfig) => void;
  saveConfig: () => void;
  submitOrders: () => void;
  resumeCopying: () => void;
  copyStats: ReturnType<typeof aggregate>;
  organicStats: ReturnType<typeof aggregate>;
  comparison: ReturnType<typeof compareCopyVsOrganic>;
}

function emptyDryRun(config: CopyConfig, portfolio: PortfolioState): SimulationResult {
  return {
    configId: config.id,
    decisions: [],
    orders: [],
    rejections: [],
    equityCurve: [
      {
        date: config.createdAt.slice(0, 10),
        equityUsd: portfolio.equityUsd,
        drawdownPct: portfolio.drawdownPct,
      },
    ],
    finalPortfolio: portfolio,
    deployedUsd: 0,
    feesUsd: 0,
    simulatedReturnPct: 0,
  };
}

export function useCopyTrading(options: UseCopyTradingOptions = {}): UseCopyTradingReturn {
  const viewerId = options.viewerId ?? DEMO_FOLLOWER_ID;
  const isTraderFollowing = options.isTraderFollowing;

  const [configs, setConfigs] = useState<CopyConfig[]>(() => {
    const stored = loadCopyConfigs();
    return stored.length > 0 ? stored : SAMPLE_COPY_CONFIGS.map((c) => ({ ...c }));
  });

  const initialTrader = options.initialTraderId ?? SAMPLE_COPY_CONFIGS[0].traderId;
  const [traderId, setTraderId] = useState(initialTrader);

  const [config, setConfig] = useState<CopyConfig>(() => {
    const existing = configs.find((c) => c.traderId === initialTrader);
    return existing ? { ...existing } : makeCopyConfig(viewerId, initialTrader);
  });

  const [portfolio, setPortfolio] = useState<PortfolioState>(() => demoPortfolio());

  const fieldErrors = useMemo(() => validateCopyConfig(config), [config]);
  const isConfigValid = fieldErrors.length === 0;

  const trades = useMemo(
    () => SAMPLE_LEADER_TRADES.filter((t) => t.traderId === traderId),
    [traderId],
  );

  const followingTrader = isTraderFollowing ? isTraderFollowing(traderId) : true;

  const dryRun = useMemo(() => {
    if (!isConfigValid) return emptyDryRun(config, portfolio);
    return simulateCopyWindow(trades, config, portfolio, { following: followingTrader });
  }, [isConfigValid, config, portfolio, trades, followingTrader]);

  const autoStop = useMemo<CopyAutoStopStatus>(() => {
    const base = evaluateAutoStop(config, portfolio);
    if (base.active) return { active: true, reason: base.reason, at: portfolio.autoStop.at };
    const after = dryRun.finalPortfolio.autoStop;
    if (after.active) return { active: true, reason: after.reason, at: after.at };
    return { active: false, reason: null, at: null };
  }, [config, portfolio, dryRun]);

  const remainingAllowanceUsd = useMemo(
    () => remainingAllowance(config, portfolio),
    [config, portfolio],
  );

  const selectTrader = useCallback(
    (nextTraderId: string) => {
      setTraderId(nextTraderId);
      setConfig(() => {
        const existing = configs.find((c) => c.traderId === nextTraderId);
        return existing ? { ...existing } : makeCopyConfig(viewerId, nextTraderId);
      });
    },
    [configs, viewerId],
  );

  const updateConfig = useCallback((patch: Partial<CopyConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch, updatedAt: new Date().toISOString() }));
  }, []);

  const applyStrategyConfig = useCallback((next: CopyConfig) => {
    setTraderId(next.traderId);
    setConfig(next);
  }, []);

  const saveConfig = useCallback(() => {
    if (validateCopyConfig(config).length > 0) return;
    setConfigs((prev) => {
      const next = upsertCopyConfig(prev, config);
      saveCopyConfigs(next);
      return next;
    });
  }, [config]);

  const submitOrders = useCallback(() => {
    if (validateCopyConfig(config).length > 0 || dryRun.orders.length === 0) return;
    setPortfolio(applyCopyOrders(portfolio, dryRun.orders));
    setConfigs((prev) => {
      const next = upsertCopyConfig(prev, config);
      saveCopyConfigs(next);
      return next;
    });
  }, [config, dryRun.orders, portfolio]);

  const resumeCopying = useCallback(() => {
    setPortfolio((prev) => clearAutoStop(prev));
  }, []);

  const copyStats = useMemo(
    () => aggregate(SAMPLE_COPY_RESULTS, { followerId: viewerId }),
    [viewerId],
  );

  const organicStats = useMemo(
    () => aggregate(SAMPLE_ORGANIC_RESULTS, { followerId: viewerId }),
    [viewerId],
  );

  const comparison = useMemo(
    () => compareCopyVsOrganic(SAMPLE_COPY_RESULTS, SAMPLE_ORGANIC_RESULTS, { followerId: viewerId }),
    [viewerId],
  );

  return useMemo(
    () => ({
      viewerId,
      configs,
      traderId,
      config,
      fieldErrors,
      isConfigValid,
      trades,
      portfolio,
      remainingAllowanceUsd,
      dryRun,
      plannedOrders: dryRun.orders,
      rejections: dryRun.rejections,
      autoStop,
      followingTrader,
      selectTrader,
      updateConfig,
      applyStrategyConfig,
      saveConfig,
      submitOrders,
      resumeCopying,
      copyStats,
      organicStats,
      comparison,
    }),
    [
      viewerId,
      configs,
      traderId,
      config,
      fieldErrors,
      isConfigValid,
      trades,
      portfolio,
      remainingAllowanceUsd,
      dryRun,
      autoStop,
      followingTrader,
      selectTrader,
      updateConfig,
      applyStrategyConfig,
      saveConfig,
      submitOrders,
      resumeCopying,
      copyStats,
      organicStats,
      comparison,
    ],
  );
}
