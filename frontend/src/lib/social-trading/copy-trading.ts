/**
 * Copy-trading decision engine (issue #1212).
 *
 * The engine is pure: given a leader trade event, a follower's `CopyConfig` and a
 * snapshot of the follower's `PortfolioState` it returns a `CopyDecision` — either
 * a sized `CopyOrder` or a machine-readable rejection code. No network, no React.
 *
 * Guard evaluation order (each earlier guard short-circuits the later ones):
 *   INVALID_INPUT -> COPY_DISABLED -> NOT_FOLLOWING -> BLACKLISTED -> DUPLICATE
 *   -> AUTO_STOP_ACTIVE -> sizing -> BELOW_MINIMUM -> MONTHLY_LIMIT_REACHED
 *   -> EXCEEDS_PER_TRADE_LIMIT -> (monthly partial fill) -> INSUFFICIENT_BALANCE
 */

import { currentPeriod } from './profiles';
import { isAcceptedCopyDecision } from './types';
import type {
  CopyConfig,
  CopyDecision,
  CopyMode,
  CopyOrder,
  CopyRejection,
  CopyRejectionCode,
  CopyTradeEvent,
  FieldError,
  OpenPosition,
  PortfolioState,
  SimulationResult,
} from './types';

/** Platform + settlement fee charged on every copied ticket, in basis points. */
export const DEFAULT_FEE_BPS = 30;

/** Inverse-risk mode scales the risk budget down as deal risk rises. */
export const RISK_MULTIPLIERS: Record<CopyTradeEvent['riskRating'], number> = {
  Low: 1,
  Medium: 0.6,
  High: 0.3,
};

export const REJECTION_MESSAGES: Record<CopyRejectionCode, string> = {
  BELOW_MINIMUM: 'The copied ticket falls below your minimum trade size.',
  EXCEEDS_PER_TRADE_LIMIT: 'The leader ticket exceeds your per-trade cap.',
  MONTHLY_LIMIT_REACHED: 'You have used up this month\'s copy allowance.',
  BLACKLISTED: 'This deal matches an entry on your copy blacklist.',
  AUTO_STOP_ACTIVE: 'Auto-stop is active, so copying is paused.',
  DUPLICATE: 'You already hold a copy of this deal.',
  INSUFFICIENT_BALANCE: 'Not enough available balance to copy this trade.',
  NOT_FOLLOWING: 'You are not following this trader.',
  COPY_DISABLED: 'Copy trading is switched off for this trader.',
  INVALID_INPUT: 'The trade or copy settings are not valid.',
};

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function estimatedFees(amountUsd: number, feeBps: number = DEFAULT_FEE_BPS): number {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return 0;
  return round2((amountUsd * feeBps) / 10_000);
}

export function createEmptyPortfolio(
  followerId: string,
  options: {
    cashUsd?: number;
    followerAumUsd?: number;
    leaderAumUsd?: number;
    monthKey?: string;
    startingEquityUsd?: number;
  } = {},
): PortfolioState {
  const cashUsd = options.cashUsd ?? 0;
  const followerAumUsd = options.followerAumUsd ?? cashUsd;
  const startingEquityUsd = options.startingEquityUsd ?? followerAumUsd;
  return {
    followerId,
    cashUsd,
    followerAumUsd,
    leaderAumUsd: options.leaderAumUsd ?? 0,
    monthSpendUsd: 0,
    monthKey: options.monthKey ?? currentPeriod(new Date().toISOString()),
    positions: [],
    copiedDealIds: [],
    equityUsd: cashUsd,
    peakEquityUsd: Math.max(cashUsd, startingEquityUsd),
    drawdownPct: 0,
    unrealizedPct: 0,
    autoStop: { active: false, reason: null, at: null },
    startingEquityUsd,
  };
}

export function positionValueUsd(portfolio: PortfolioState): number {
  return portfolio.positions.reduce((sum, p) => sum + p.currentUsd, 0);
}

/** Recomputes derived balances (cash is untouched); keeps equity/peak/drawdown in sync. */
export function recomputePortfolio(portfolio: PortfolioState): PortfolioState {
  const positions = positionValueUsd(portfolio);
  const equityUsd = round2(portfolio.cashUsd + positions);
  const peakEquityUsd = Math.max(portfolio.peakEquityUsd, equityUsd);
  const drawdownPct =
    peakEquityUsd > 0 ? round2(((peakEquityUsd - equityUsd) / peakEquityUsd) * 100) : 0;
  const unrealizedPct =
    portfolio.startingEquityUsd > 0
      ? round2((equityUsd / portfolio.startingEquityUsd - 1) * 100)
      : 0;
  return {
    ...portfolio,
    equityUsd,
    followerAumUsd: equityUsd,
    peakEquityUsd,
    drawdownPct,
    unrealizedPct,
  };
}

export function remainingAllowance(
  config: CopyConfig,
  portfolio: PortfolioState,
): number {
  return Math.max(0, round2(config.monthlyLimit - portfolio.monthSpendUsd));
}

export function availableForCopying(
  config: CopyConfig,
  portfolio: PortfolioState,
): number {
  return Math.min(remainingAllowance(config, portfolio), portfolio.cashUsd);
}

/** Ticket size implied by the copy mode, before any cap is applied. */
export function sizeCopyTrade(
  trade: CopyTradeEvent,
  config: CopyConfig,
  portfolio: PortfolioState,
): number {
  switch (config.mode as CopyMode) {
    case 'fixed':
      return round2(config.fixedAmountUsd);
    case 'inverse_risk': {
      const multiplier = RISK_MULTIPLIERS[trade.riskRating] ?? 1;
      return round2(
        portfolio.followerAumUsd * (config.riskBudgetPct / 100) * multiplier,
      );
    }
    case 'proportional':
    default: {
      // Mirror the leader's portfolio weight: follower ticket = follower AUM *
      // (leader ticket / leader AUM) * allocation percentage.
      if (portfolio.leaderAumUsd <= 0) return 0;
      const leaderWeight = trade.amountUsd / portfolio.leaderAumUsd;
      return round2(
        portfolio.followerAumUsd * leaderWeight * (config.allocationPct / 100),
      );
    }
  }
}

export interface AutoStopEvaluation {
  active: boolean;
  reason: string | null;
}

export function evaluateAutoStop(
  config: CopyConfig,
  portfolio: PortfolioState,
): AutoStopEvaluation {
  if (portfolio.autoStop.active) {
    return {
      active: true,
      reason: portfolio.autoStop.reason ?? 'Auto-stop previously triggered.',
    };
  }
  if (
    Number.isFinite(config.maxDrawdownPct) &&
    portfolio.drawdownPct >= config.maxDrawdownPct
  ) {
    return {
      active: true,
      reason: `Drawdown ${portfolio.drawdownPct}% has reached your ${config.maxDrawdownPct}% limit.`,
    };
  }
  if (
    config.autoStopLossPct > 0 &&
    portfolio.unrealizedPct <= -config.autoStopLossPct
  ) {
    return {
      active: true,
      reason: `Unrealised loss ${portfolio.unrealizedPct}% has hit your -${config.autoStopLossPct}% stop.`,
    };
  }
  if (
    config.autoTakeProfitPct > 0 &&
    portfolio.unrealizedPct >= config.autoTakeProfitPct
  ) {
    return {
      active: true,
      reason: `Unrealised gain ${portfolio.unrealizedPct}% reached your +${config.autoTakeProfitPct}% target.`,
    };
  }
  return { active: false, reason: null };
}

export function refreshAutoStop(
  config: CopyConfig,
  portfolio: PortfolioState,
  at?: string,
): PortfolioState {
  const evaluation = evaluateAutoStop(config, portfolio);
  if (!evaluation.active) return portfolio;
  if (portfolio.autoStop.active) return portfolio;
  return {
    ...portfolio,
    autoStop: { active: true, reason: evaluation.reason, at: at ?? new Date().toISOString() },
  };
}

/**
 * Auto-stop is deliberately sticky: a portfolio that recovers on its own should
 * not silently resume mirroring the leader. Only an explicit reset (the UI's
 * "resume copying" action) clears the guard.
 */
export function clearAutoStop(portfolio: PortfolioState): PortfolioState {
  if (!portfolio.autoStop.active) return portfolio;
  return { ...portfolio, autoStop: { active: false, reason: null, at: null } };
}

export function isBlacklisted(trade: CopyTradeEvent, config: CopyConfig): string | null {
  if (config.blacklist.length === 0) return null;
  const entries = config.blacklist.map((b) => String(b).trim().toLowerCase()).filter(Boolean);
  const candidates = [trade.dealId, trade.commodity, trade.region];
  for (const candidate of candidates) {
    if (entries.includes(String(candidate).trim().toLowerCase())) return candidate;
  }
  return null;
}

function reject(
  code: CopyRejectionCode,
  proposedAmountUsd: number,
  details: Record<string, string | number> = {},
  message?: string,
): CopyDecision {
  const rejection: CopyRejection = {
    code,
    message: message ?? REJECTION_MESSAGES[code],
    details: { proposedAmountUsd, ...details },
  };
  return {
    accepted: false,
    reason: code,
    message: rejection.message,
    rejection,
    proposedAmountUsd,
  };
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function planCopyOrder(
  trade: CopyTradeEvent,
  config: CopyConfig,
  portfolio: PortfolioState,
  context: { following?: boolean; now?: string } = {},
): CopyDecision {
  const following = context.following ?? true;

  if (
    !trade ||
    !config ||
    !isPositiveFinite(trade.amountUsd) ||
    !Number.isFinite(config.minTradeValue) ||
    config.minTradeValue < 0 ||
    !isPositiveFinite(config.maxPerTrade) ||
    !isPositiveFinite(config.monthlyLimit)
  ) {
    return reject('INVALID_INPUT', 0, {
      tradeAmountUsd: trade?.amountUsd ?? 0,
      maxPerTrade: config?.maxPerTrade ?? 0,
      monthlyLimit: config?.monthlyLimit ?? 0,
    });
  }

  if (!config.enabled) {
    return reject('COPY_DISABLED', 0, { traderId: config.traderId });
  }

  if (!following || config.followerId !== portfolio.followerId) {
    return reject('NOT_FOLLOWING', 0, {
      traderId: config.traderId,
      followerId: portfolio.followerId,
    });
  }

  const blacklistMatch = isBlacklisted(trade, config);
  if (blacklistMatch) {
    return reject('BLACKLISTED', 0, { matched: blacklistMatch, dealId: trade.dealId });
  }

  if (portfolio.copiedDealIds.includes(trade.dealId)) {
    return reject('DUPLICATE', 0, { dealId: trade.dealId });
  }

  const autoStop = evaluateAutoStop(config, portfolio);
  if (autoStop.active) {
    return reject('AUTO_STOP_ACTIVE', 0, {
      drawdownPct: portfolio.drawdownPct,
      unrealizedPct: portfolio.unrealizedPct,
      trigger: autoStop.reason ?? '',
    });
  }

  const sized = sizeCopyTrade(trade, config, portfolio);
  const remaining = remainingAllowance(config, portfolio);

  if (sized < config.minTradeValue) {
    return reject('BELOW_MINIMUM', sized, {
      minTradeValue: config.minTradeValue,
      sizedAmountUsd: sized,
    });
  }

  if (remaining <= 0) {
    return reject('MONTHLY_LIMIT_REACHED', sized, {
      monthlyLimit: config.monthlyLimit,
      monthSpendUsd: portfolio.monthSpendUsd,
      remainingAllowanceUsd: 0,
    });
  }

  // The per-trade cap is a hard reject: shrinking a proportional mirror on every
  // large leader ticket silently breaks copy fidelity, so the follower must see it.
  if (sized > config.maxPerTrade) {
    return reject('EXCEEDS_PER_TRADE_LIMIT', sized, {
      maxPerTrade: config.maxPerTrade,
      sizedAmountUsd: sized,
      leaderAmountUsd: round2(trade.amountUsd),
    });
  }

  // The monthly allowance is clamped instead: a partial fill keeps the follower
  // inside their budget while still mirroring the rest of the trade.
  const amount = Math.min(sized, remaining);
  if (amount < config.minTradeValue) {
    return reject('MONTHLY_LIMIT_REACHED', sized, {
      remainingAllowanceUsd: remaining,
      minTradeValue: config.minTradeValue,
    });
  }

  const feeUsd = estimatedFees(amount, config.feeBps);
  if (portfolio.cashUsd < amount + feeUsd) {
    return reject('INSUFFICIENT_BALANCE', amount, {
      cashUsd: portfolio.cashUsd,
      requiredUsd: round2(amount + feeUsd),
    });
  }

  const order: CopyOrder = {
    id: `copy:${config.id}:${trade.dealId}`,
    configId: config.id,
    followerId: config.followerId,
    traderId: config.traderId,
    dealId: trade.dealId,
    commodity: trade.commodity,
    region: trade.region,
    createdAt: context.now ?? trade.date,
    leaderAmountUsd: round2(trade.amountUsd),
    sizedAmountUsd: sized,
    amountUsd: round2(amount),
    feeUsd,
    expectedRoiPct: trade.expectedRoiPct,
    status: 'planned',
    sizingBasis: config.mode,
  };

  return {
    accepted: true,
    reason: null,
    message: `Copying ${order.amountUsd} USD of deal ${order.dealId}.`,
    order,
  };
}

/** Moves the monthly allowance counter when the window crosses into a new month. */
export function rolloverMonth(portfolio: PortfolioState, isoDate: string): PortfolioState {
  const period = currentPeriod(isoDate);
  if (period === portfolio.monthKey) return portfolio;
  return { ...portfolio, monthKey: period, monthSpendUsd: 0 };
}

export function applyCopyOrders(
  portfolio: PortfolioState,
  orders: CopyOrder[],
): PortfolioState {
  let cashUsd = portfolio.cashUsd;
  let monthSpendUsd = portfolio.monthSpendUsd;
  const positions = [...portfolio.positions];
  const copiedDealIds = [...portfolio.copiedDealIds];

  for (const order of orders) {
    cashUsd = round2(cashUsd - order.amountUsd - order.feeUsd);
    monthSpendUsd = round2(monthSpendUsd + order.amountUsd);
    const position: OpenPosition = {
      dealId: order.dealId,
      traderId: order.traderId,
      openedAt: order.createdAt,
      investedUsd: order.amountUsd,
      currentUsd: order.amountUsd,
    };
    positions.push(position);
    if (!copiedDealIds.includes(order.dealId)) copiedDealIds.push(order.dealId);
  }

  return recomputePortfolio({
    ...portfolio,
    cashUsd,
    monthSpendUsd,
    positions,
    copiedDealIds,
  });
}

/** Applies one mark-to-market step across the whole open book. */
export function markToMarket(
  portfolio: PortfolioState,
  roiPct: number,
): PortfolioState {
  const factor = 1 + roiPct / 100;
  const positions = portfolio.positions.map((p) => ({
    ...p,
    currentUsd: round2(p.currentUsd * factor),
  }));
  return recomputePortfolio({ ...portfolio, positions });
}

export function closePosition(
  portfolio: PortfolioState,
  dealId: string,
): PortfolioState {
  const position = portfolio.positions.find((p) => p.dealId === dealId);
  if (!position) return portfolio;
  return recomputePortfolio({
    ...portfolio,
    cashUsd: round2(portfolio.cashUsd + position.currentUsd),
    positions: portfolio.positions.filter((p) => p.dealId !== dealId),
  });
}

export function sortTradeEvents(trades: CopyTradeEvent[]): CopyTradeEvent[] {
  return [...trades].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.dealId.localeCompare(b.dealId),
  );
}

export function simulateCopyWindow(
  trades: CopyTradeEvent[],
  config: CopyConfig,
  portfolio: PortfolioState,
  options: { following?: boolean; markAfterEach?: boolean } = {},
): SimulationResult {
  const markAfterEach = options.markAfterEach ?? true;
  const ordered = sortTradeEvents(trades);

  let state = portfolio;
  const decisions: SimulationResult['decisions'] = [];
  const orders: CopyOrder[] = [];
  const rejections: CopyRejection[] = [];
  const equityCurve = [
    { date: config.createdAt.slice(0, 10), equityUsd: state.equityUsd, drawdownPct: state.drawdownPct },
  ];

  for (const trade of ordered) {
    state = rolloverMonth(state, trade.date);
    state = refreshAutoStop(config, state, trade.date);

    const decision = planCopyOrder(trade, config, state, {
      following: options.following ?? true,
      now: trade.date,
    });
    decisions.push({ trade, decision });

    if (isAcceptedCopyDecision(decision)) {
      state = applyCopyOrders(state, [decision.order]);
      orders.push(decision.order);
      if (markAfterEach) state = markToMarket(state, trade.realizedRoiPct ?? trade.expectedRoiPct);
    } else {
      rejections.push(decision.rejection);
      if (markAfterEach && trade.realizedRoiPct !== undefined) {
        state = markToMarket(state, trade.realizedRoiPct);
      }
    }

    state = refreshAutoStop(config, state, trade.date);
    equityCurve.push({
      date: trade.date,
      equityUsd: state.equityUsd,
      drawdownPct: state.drawdownPct,
    });
  }

  const deployedUsd = round2(orders.reduce((sum, o) => sum + o.amountUsd, 0));
  const feesUsd = round2(orders.reduce((sum, o) => sum + o.feeUsd, 0));
  const simulatedReturnPct =
    state.startingEquityUsd > 0
      ? round2((state.equityUsd / state.startingEquityUsd - 1) * 100)
      : 0;

  return {
    configId: config.id,
    decisions,
    orders,
    rejections,
    equityCurve,
    finalPortfolio: state,
    deployedUsd,
    feesUsd,
    simulatedReturnPct,
  };
}

/** Form-level validation shared by `CopyTradingControls` and the engine guards. */
export function validateCopyConfig(config: Partial<CopyConfig>): FieldError[] {
  const errors: FieldError[] = [];
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN);

  const minTradeValue = num(config.minTradeValue);
  const maxPerTrade = num(config.maxPerTrade);
  const monthlyLimit = num(config.monthlyLimit);

  if (Number.isNaN(minTradeValue) || minTradeValue < 0)
    errors.push({ path: 'minTradeValue', message: 'Minimum trade size must be zero or more.' });
  if (Number.isNaN(maxPerTrade) || maxPerTrade <= 0)
    errors.push({ path: 'maxPerTrade', message: 'Per-trade cap must be greater than zero.' });
  if (Number.isNaN(monthlyLimit) || monthlyLimit <= 0)
    errors.push({ path: 'monthlyLimit', message: 'Monthly limit must be greater than zero.' });

  if (!Number.isNaN(maxPerTrade) && !Number.isNaN(minTradeValue) && maxPerTrade < minTradeValue)
    errors.push({ path: 'maxPerTrade', message: 'Per-trade cap must be at least the minimum trade size.' });
  if (!Number.isNaN(monthlyLimit) && !Number.isNaN(minTradeValue) && monthlyLimit < minTradeValue)
    errors.push({ path: 'monthlyLimit', message: 'Monthly limit must be at least the minimum trade size.' });
  if (!Number.isNaN(monthlyLimit) && !Number.isNaN(maxPerTrade) && monthlyLimit < maxPerTrade)
    errors.push({ path: 'monthlyLimit', message: 'Monthly limit cannot be lower than the per-trade cap.' });

  if (config.mode === 'fixed') {
    const fixed = num(config.fixedAmountUsd);
    if (Number.isNaN(fixed) || fixed <= 0)
      errors.push({ path: 'fixedAmountUsd', message: 'Fixed copy amount must be greater than zero.' });
    else if (!Number.isNaN(maxPerTrade) && fixed > maxPerTrade)
      errors.push({ path: 'fixedAmountUsd', message: 'Fixed amount exceeds the per-trade cap.' });
  }
  if (config.mode === 'proportional') {
    const allocation = num(config.allocationPct);
    if (Number.isNaN(allocation) || allocation <= 0 || allocation > 100)
      errors.push({ path: 'allocationPct', message: 'Allocation must be between 1% and 100%.' });
  }
  if (config.mode === 'inverse_risk') {
    const budget = num(config.riskBudgetPct);
    if (Number.isNaN(budget) || budget <= 0 || budget > 100)
      errors.push({ path: 'riskBudgetPct', message: 'Risk budget must be between 1% and 100%.' });
  }

  const stopLoss = num(config.autoStopLossPct);
  if (Number.isNaN(stopLoss) || stopLoss < 0 || stopLoss > 100)
    errors.push({ path: 'autoStopLossPct', message: 'Stop-loss must be between 0% and 100%.' });
  const takeProfit = num(config.autoTakeProfitPct);
  if (Number.isNaN(takeProfit) || takeProfit < 0 || takeProfit > 500)
    errors.push({ path: 'autoTakeProfitPct', message: 'Take-profit must be between 0% and 500%.' });
  const maxDrawdown = num(config.maxDrawdownPct);
  if (Number.isNaN(maxDrawdown) || maxDrawdown <= 0 || maxDrawdown > 100)
    errors.push({ path: 'maxDrawdownPct', message: 'Max drawdown must be between 1% and 100%.' });

  return errors;
}

/**
 * Config persistence mirrors `follow.ts`: a versioned localStorage key, SSR-safe
 * and inert when storage is unavailable.
 */
export const COPY_CONFIG_STORAGE_KEY = 'agrifi.social-trading.copy-configs.v1';

export function loadCopyConfigs(): CopyConfig[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(COPY_CONFIG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { configs?: CopyConfig[] };
    return Array.isArray(parsed.configs) ? parsed.configs : [];
  } catch {
    return [];
  }
}

export function saveCopyConfigs(configs: CopyConfig[]): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(
      COPY_CONFIG_STORAGE_KEY,
      JSON.stringify({ version: 1, configs }),
    );
    return true;
  } catch {
    return false;
  }
}

export function upsertCopyConfig(configs: CopyConfig[], config: CopyConfig): CopyConfig[] {
  const index = configs.findIndex((c) => c.id === config.id);
  if (index === -1) return [...configs, config];
  const next = [...configs];
  next[index] = config;
  return next;
}

export function removeCopyConfig(configs: CopyConfig[], configId: string): CopyConfig[] {
  return configs.filter((c) => c.id !== configId);
}

export function makeCopyConfig(
  followerId: string,
  traderId: string,
  overrides: Partial<CopyConfig> = {},
): CopyConfig {
  const now = new Date().toISOString();
  return {
    id: `copycfg:${followerId}:${traderId}`,
    followerId,
    traderId,
    mode: 'proportional',
    allocationPct: 100,
    fixedAmountUsd: 500,
    riskBudgetPct: 5,
    maxPerTrade: 2_000,
    monthlyLimit: 10_000,
    minTradeValue: 100,
    autoStopLossPct: 10,
    autoTakeProfitPct: 25,
    maxDrawdownPct: 15,
    feeBps: DEFAULT_FEE_BPS,
    blacklist: [],
    notifications: true,
    enabled: true,
    derivedFromStrategyId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
