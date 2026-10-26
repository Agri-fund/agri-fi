import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FEE_BPS,
  RISK_MULTIPLIERS,
  applyCopyOrders,
  availableForCopying,
  clearAutoStop,
  closePosition,
  createEmptyPortfolio,
  estimatedFees,
  evaluateAutoStop,
  isBlacklisted,
  makeCopyConfig,
  markToMarket,
  planCopyOrder,
  refreshAutoStop,
  recomputePortfolio,
  remainingAllowance,
  removeCopyConfig,
  rolloverMonth,
  round2,
  simulateCopyWindow,
  sizeCopyTrade,
  sortTradeEvents,
  upsertCopyConfig,
  validateCopyConfig,
} from '../copy-trading';
import type { CopyTradeEvent, PortfolioState } from '../types';

const CONFIG = makeCopyConfig('f1', 't1', {
  id: 'cfg1',
  createdAt: '2026-08-01T00:00:00.000Z',
  allocationPct: 100,
  maxPerTrade: 1000,
  monthlyLimit: 1500,
  minTradeValue: 100,
  feeBps: DEFAULT_FEE_BPS,
  autoStopLossPct: 25,
  autoTakeProfitPct: 100,
  maxDrawdownPct: 8,
});

function portfolio(overrides: Partial<PortfolioState> = {}): PortfolioState {
  return {
    ...createEmptyPortfolio('f1', {
      cashUsd: 5000,
      followerAumUsd: 5000,
      leaderAumUsd: 50_000,
      monthKey: '2026-09',
      startingEquityUsd: 5000,
    }),
    ...overrides,
  };
}

function trade(overrides: Partial<CopyTradeEvent> = {}): CopyTradeEvent {
  return {
    traderId: 't1',
    dealId: 'deal-1',
    date: '2026-09-05',
    amountUsd: 10_000,
    commodity: 'Coffee',
    region: 'Kenya',
    riskRating: 'Low',
    expectedRoiPct: 8,
    realizedRoiPct: 8,
    ...overrides,
  };
}

describe('estimatedFees', () => {
  it('charges the configured basis points', () => {
    expect(estimatedFees(1000, 30)).toBe(3);
    expect(estimatedFees(1234.56, 30)).toBe(3.7);
    expect(estimatedFees(1000, 100)).toBe(10);
  });

  it('returns zero for empty amounts and zero fee rates', () => {
    expect(estimatedFees(0, 30)).toBe(0);
    expect(estimatedFees(-25, 30)).toBe(0);
    expect(estimatedFees(Number.NaN, 30)).toBe(0);
    expect(estimatedFees(1000, 0)).toBe(0);
  });

  it('defaults to the platform fee rate', () => {
    expect(DEFAULT_FEE_BPS).toBe(30);
    expect(estimatedFees(500)).toBe(1.5);
  });
});

describe('sizeCopyTrade', () => {
  it('mirrors the leader weight in proportional mode', () => {
    const sized = sizeCopyTrade(trade({ amountUsd: 7500 }), CONFIG, portfolio());
    // 5000 AUM * (7500 / 50000 leader AUM) * 100% allocation.
    expect(sized).toBe(750);
  });

  it('scales proportional sizing by the allocation percentage', () => {
    expect(sizeCopyTrade(trade(), { ...CONFIG, allocationPct: 9 }, portfolio())).toBe(90);
    expect(sizeCopyTrade(trade(), { ...CONFIG, allocationPct: 50 }, portfolio())).toBe(500);
  });

  it('uses the flat amount in fixed mode', () => {
    expect(
      sizeCopyTrade(trade(), { ...CONFIG, mode: 'fixed', fixedAmountUsd: 300 }, portfolio()),
    ).toBe(300);
  });

  it('shrinks the risk budget as deal risk rises in inverse-risk mode', () => {
    const config = { ...CONFIG, mode: 'inverse_risk' as const, riskBudgetPct: 5 };
    expect(RISK_MULTIPLIERS).toEqual({ Low: 1, Medium: 0.6, High: 0.3 });
    expect(sizeCopyTrade(trade({ riskRating: 'Low' }), config, portfolio())).toBe(250);
    expect(sizeCopyTrade(trade({ riskRating: 'Medium' }), config, portfolio())).toBe(150);
    expect(sizeCopyTrade(trade({ riskRating: 'High' }), config, portfolio())).toBe(75);
  });

  it('sizes nothing when the leader AUM denominator is missing', () => {
    expect(sizeCopyTrade(trade(), CONFIG, portfolio({ leaderAumUsd: 0 }))).toBe(0);
  });
});

describe('remainingAllowance / availableForCopying', () => {
  it('subtracts the committed month spend from the limit', () => {
    expect(remainingAllowance(CONFIG, portfolio({ monthSpendUsd: 1200 }))).toBe(300);
    expect(remainingAllowance(CONFIG, portfolio({ monthSpendUsd: 1500 }))).toBe(0);
    expect(remainingAllowance(CONFIG, portfolio({ monthSpendUsd: 2000 }))).toBe(0);
  });

  it('is bounded by the available cash', () => {
    expect(availableForCopying(CONFIG, portfolio({ monthSpendUsd: 1200, cashUsd: 120 }))).toBe(120);
    expect(availableForCopying(CONFIG, portfolio({ monthSpendUsd: 1200 }))).toBe(300);
  });
});

describe('planCopyOrder accepted paths', () => {
  it('sizes, fees and tags a proportional mirror', () => {
    const decision = planCopyOrder(trade(), CONFIG, portfolio());
    expect(decision.accepted).toBe(true);
    if (!decision.accepted) throw new Error('expected acceptance');
    expect(decision.reason).toBeNull();
    expect(decision.order).toMatchObject({
      id: 'copy:cfg1:deal-1',
      configId: 'cfg1',
      followerId: 'f1',
      traderId: 't1',
      dealId: 'deal-1',
      commodity: 'Coffee',
      region: 'Kenya',
      createdAt: '2026-09-05',
      leaderAmountUsd: 10_000,
      sizedAmountUsd: 1000,
      amountUsd: 1000,
      feeUsd: 3,
      expectedRoiPct: 8,
      status: 'planned',
      sizingBasis: 'proportional',
    });
    expect(decision.message).toBe('Copying 1000 USD of deal deal-1.');
  });

  it('accepts a fixed-mode ticket regardless of the leader size', () => {
    const config = { ...CONFIG, mode: 'fixed' as const, fixedAmountUsd: 300 };
    const decision = planCopyOrder(trade({ amountUsd: 40_000 }), config, portfolio());
    expect(decision.accepted).toBe(true);
    if (!decision.accepted) throw new Error('expected acceptance');
    expect(decision.order.amountUsd).toBe(300);
    expect(decision.order.feeUsd).toBe(0.9);
    expect(decision.order.sizingBasis).toBe('fixed');
  });

  it('accepts an inverse-risk ticket sized on the deal risk rating', () => {
    const config = { ...CONFIG, mode: 'inverse_risk' as const, riskBudgetPct: 5 };
    const decision = planCopyOrder(trade({ riskRating: 'Medium' }), config, portfolio());
    expect(decision.accepted).toBe(true);
    if (!decision.accepted) throw new Error('expected acceptance');
    expect(decision.order.amountUsd).toBe(150);
  });

  it('accepts a ticket exactly at the per-trade cap and at the minimum size', () => {
    expect(planCopyOrder(trade(), CONFIG, portfolio()).accepted).toBe(true);
    const atMinimum = planCopyOrder(
      trade({ amountUsd: 1000 }),
      { ...CONFIG, minTradeValue: 100 },
      portfolio(),
    );
    // 5000 * (1000 / 50000) = 100 USD, equal to the minimum so it still copies.
    expect(atMinimum.accepted).toBe(true);
  });

  it('partially fills when the monthly allowance is the binding cap', () => {
    const decision = planCopyOrder(
      trade({ amountUsd: 8000 }),
      CONFIG,
      portfolio({ monthSpendUsd: 1200 }),
    );
    expect(decision.accepted).toBe(true);
    if (!decision.accepted) throw new Error('expected acceptance');
    expect(decision.order.sizedAmountUsd).toBe(800);
    expect(decision.order.amountUsd).toBe(300);
    expect(decision.order.feeUsd).toBe(0.9);
  });

  it('honours an explicit creation timestamp over the trade date', () => {
    const decision = planCopyOrder(trade(), CONFIG, portfolio(), { now: '2026-09-06T10:00:00.000Z' });
    expect(decision.accepted).toBe(true);
    if (!decision.accepted) throw new Error('expected acceptance');
    expect(decision.order.createdAt).toBe('2026-09-06T10:00:00.000Z');
  });
});

describe('planCopyOrder rejections', () => {
  it('INVALID_INPUT on non-positive or non-finite trade amounts', () => {
    for (const amount of [0, -500, Number.NaN]) {
      const decision = planCopyOrder(trade({ amountUsd: amount }), CONFIG, portfolio());
      expect(decision.accepted).toBe(false);
      if (decision.accepted) throw new Error('expected rejection');
      expect(decision.reason).toBe('INVALID_INPUT');
      expect(decision.proposedAmountUsd).toBe(0);
      expect(decision.rejection.code).toBe('INVALID_INPUT');
    }
  });

  it('INVALID_INPUT on impossible config limits', () => {
    expect(planCopyOrder(trade(), { ...CONFIG, maxPerTrade: 0 }, portfolio()).reason).toBe(
      'INVALID_INPUT',
    );
    expect(planCopyOrder(trade(), { ...CONFIG, monthlyLimit: -1 }, portfolio()).reason).toBe(
      'INVALID_INPUT',
    );
    expect(planCopyOrder(trade(), { ...CONFIG, minTradeValue: -1 }, portfolio()).reason).toBe(
      'INVALID_INPUT',
    );
  });

  it('INVALID_INPUT is checked before the enabled switch', () => {
    const decision = planCopyOrder(
      trade({ amountUsd: 0 }),
      { ...CONFIG, enabled: false },
      portfolio(),
    );
    expect(decision.reason).toBe('INVALID_INPUT');
  });

  it('COPY_DISABLED when the switch is off', () => {
    const decision = planCopyOrder(trade(), { ...CONFIG, enabled: false }, portfolio());
    expect(decision.accepted).toBe(false);
    if (decision.accepted) throw new Error('expected rejection');
    expect(decision.reason).toBe('COPY_DISABLED');
    expect(decision.rejection.details.traderId).toBe('t1');
    expect(decision.message).toBe('Copy trading is switched off for this trader.');
  });

  it('COPY_DISABLED outranks NOT_FOLLOWING', () => {
    const decision = planCopyOrder(trade(), { ...CONFIG, enabled: false }, portfolio(), {
      following: false,
    });
    expect(decision.reason).toBe('COPY_DISABLED');
  });

  it('NOT_FOLLOWING when the follow relationship is absent', () => {
    const decision = planCopyOrder(trade(), CONFIG, portfolio(), { following: false });
    expect(decision.accepted).toBe(false);
    if (decision.accepted) throw new Error('expected rejection');
    expect(decision.reason).toBe('NOT_FOLLOWING');
    expect(decision.rejection.details).toMatchObject({
      traderId: 't1',
      followerId: 'f1',
      proposedAmountUsd: 0,
    });
  });

  it('NOT_FOLLOWING when the config belongs to another follower', () => {
    const decision = planCopyOrder(trade(), { ...CONFIG, followerId: 'f2' }, portfolio());
    expect(decision.reason).toBe('NOT_FOLLOWING');
  });

  it('BLACKLISTED by deal id, commodity and region, case-insensitively', () => {
    const byDeal = planCopyOrder(
      trade({ dealId: 'deal-9' }),
      { ...CONFIG, blacklist: ['deal-9', 'Cocoa'] },
      portfolio(),
    );
    expect(byDeal.reason).toBe('BLACKLISTED');
    if (byDeal.accepted) throw new Error('expected rejection');
    expect(byDeal.rejection.details.matched).toBe('deal-9');

    const byCommodity = planCopyOrder(
      trade({ commodity: 'Cocoa' }),
      { ...CONFIG, blacklist: ['cocoa'] },
      portfolio(),
    );
    expect(byCommodity.reason).toBe('BLACKLISTED');
    if (byCommodity.accepted) throw new Error('expected rejection');
    expect(byCommodity.rejection.details.matched).toBe('Cocoa');

    const byRegion = planCopyOrder(
      trade({ region: 'Malawi' }),
      { ...CONFIG, blacklist: [' malawi '] },
      portfolio(),
    );
    expect(byRegion.reason).toBe('BLACKLISTED');

    expect(isBlacklisted(trade(), CONFIG)).toBeNull();
  });

  it('BLACKLISTED outranks the duplicate guard', () => {
    const decision = planCopyOrder(
      trade({ commodity: 'Cocoa' }),
      { ...CONFIG, blacklist: ['Cocoa'] },
      portfolio({ copiedDealIds: ['deal-1'] }),
    );
    expect(decision.reason).toBe('BLACKLISTED');
  });

  it('DUPLICATE when the deal is already copied', () => {
    const decision = planCopyOrder(trade(), CONFIG, portfolio({ copiedDealIds: ['deal-0', 'deal-1'] }));
    expect(decision.accepted).toBe(false);
    if (decision.accepted) throw new Error('expected rejection');
    expect(decision.reason).toBe('DUPLICATE');
    expect(decision.rejection.details.dealId).toBe('deal-1');
  });

  it('AUTO_STOP_ACTIVE from the sticky flag before anything is sized', () => {
    const decision = planCopyOrder(
      trade(),
      CONFIG,
      portfolio({ autoStop: { active: true, reason: 'Stopped earlier.', at: '2026-09-01' } }),
    );
    expect(decision.accepted).toBe(false);
    if (decision.accepted) throw new Error('expected rejection');
    expect(decision.reason).toBe('AUTO_STOP_ACTIVE');
    expect(decision.rejection.details.trigger).toBe('Stopped earlier.');
  });

  it('AUTO_STOP_ACTIVE when drawdown reaches the limit', () => {
    const decision = planCopyOrder(trade(), CONFIG, portfolio({ drawdownPct: 8 }));
    expect(decision.reason).toBe('AUTO_STOP_ACTIVE');
    if (decision.accepted) throw new Error('expected rejection');
    expect(decision.rejection.details.trigger).toBe('Drawdown 8% has reached your 8% limit.');
  });

  it('AUTO_STOP_ACTIVE when the unrealised loss hits the stop', () => {
    const decision = planCopyOrder(trade(), CONFIG, portfolio({ unrealizedPct: -25.4 }));
    expect(decision.reason).toBe('AUTO_STOP_ACTIVE');
  });

  it('AUTO_STOP_ACTIVE when the take-profit target is reached', () => {
    const decision = planCopyOrder(
      trade(),
      { ...CONFIG, autoTakeProfitPct: 12 },
      portfolio({ unrealizedPct: 12 }),
    );
    expect(decision.reason).toBe('AUTO_STOP_ACTIVE');
    if (decision.accepted) throw new Error('expected rejection');
    expect(decision.rejection.details.trigger).toBe(
      'Unrealised gain 12% reached your +12% target.',
    );
  });

  it('BELOW_MINIMUM when the mirror is smaller than the floor', () => {
    const decision = planCopyOrder(
      trade(),
      { ...CONFIG, allocationPct: 9 },
      portfolio(),
    );
    expect(decision.accepted).toBe(false);
    if (decision.accepted) throw new Error('expected rejection');
    expect(decision.reason).toBe('BELOW_MINIMUM');
    expect(decision.proposedAmountUsd).toBe(90);
    expect(decision.rejection.details).toMatchObject({
      minTradeValue: 100,
      sizedAmountUsd: 90,
      proposedAmountUsd: 90,
    });
  });

  it('BELOW_MINIMUM in inverse-risk mode for high-risk deals', () => {
    const config = { ...CONFIG, mode: 'inverse_risk' as const, riskBudgetPct: 5 };
    const decision = planCopyOrder(trade({ riskRating: 'High' }), config, portfolio());
    expect(decision.reason).toBe('BELOW_MINIMUM');
    if (decision.accepted) throw new Error('expected rejection');
    expect(decision.proposedAmountUsd).toBe(75);
  });

  it('MONTHLY_LIMIT_REACHED once the allowance is spent', () => {
    const decision = planCopyOrder(trade(), CONFIG, portfolio({ monthSpendUsd: 1500 }));
    expect(decision.accepted).toBe(false);
    if (decision.accepted) throw new Error('expected rejection');
    expect(decision.reason).toBe('MONTHLY_LIMIT_REACHED');
    expect(decision.proposedAmountUsd).toBe(1000);
    expect(decision.rejection.details).toMatchObject({
      monthlyLimit: 1500,
      monthSpendUsd: 1500,
      remainingAllowanceUsd: 0,
    });
  });

  it('MONTHLY_LIMIT_REACHED when the leftover allowance is below the floor', () => {
    const decision = planCopyOrder(trade(), CONFIG, portfolio({ monthSpendUsd: 1420 }));
    expect(decision.reason).toBe('MONTHLY_LIMIT_REACHED');
    if (decision.accepted) throw new Error('expected rejection');
    expect(decision.rejection.details).toMatchObject({
      remainingAllowanceUsd: 80,
      minTradeValue: 100,
    });
  });

  it('EXCEEDS_PER_TRADE_LIMIT rejects instead of silently capping', () => {
    const decision = planCopyOrder(trade({ amountUsd: 50_000 }), CONFIG, portfolio());
    expect(decision.accepted).toBe(false);
    if (decision.accepted) throw new Error('expected rejection');
    expect(decision.reason).toBe('EXCEEDS_PER_TRADE_LIMIT');
    expect(decision.proposedAmountUsd).toBe(5000);
    expect(decision.rejection.details).toMatchObject({
      maxPerTrade: 1000,
      sizedAmountUsd: 5000,
      leaderAmountUsd: 50_000,
    });
  });

  it('EXCEEDS_PER_TRADE_LIMIT beats the monthly clamp for fixed mode', () => {
    const decision = planCopyOrder(
      trade(),
      { ...CONFIG, mode: 'fixed', fixedAmountUsd: 1200 },
      portfolio(),
    );
    expect(decision.reason).toBe('EXCEEDS_PER_TRADE_LIMIT');
  });

  it('INSUFFICIENT_BALANCE once cash cannot cover the ticket and fee', () => {
    const decision = planCopyOrder(trade(), CONFIG, portfolio({ cashUsd: 900 }));
    expect(decision.accepted).toBe(false);
    if (decision.accepted) throw new Error('expected rejection');
    expect(decision.reason).toBe('INSUFFICIENT_BALANCE');
    expect(decision.proposedAmountUsd).toBe(1000);
    expect(decision.rejection.details).toMatchObject({ cashUsd: 900, requiredUsd: 1003 });
  });

  it('INSUFFICIENT_BALANCE rejects instead of clamping to the cash on hand', () => {
    const config = { ...CONFIG, maxPerTrade: 5000 };
    const decision = planCopyOrder(
      trade({ amountUsd: 20_000 }),
      config,
      portfolio({ cashUsd: 1200 }),
    );
    expect(decision.reason).toBe('INSUFFICIENT_BALANCE');
    if (decision.accepted) throw new Error('expected rejection');
    // Sized 2000, clamped to the 1500 monthly allowance, but 1504.50 is more than 1200 cash.
    expect(decision.proposedAmountUsd).toBe(1500);
    expect(decision.rejection.details).toMatchObject({
      cashUsd: 1200,
      requiredUsd: 1504.5,
    });
  });
});

describe('evaluateAutoStop / refreshAutoStop', () => {
  it('reports inactive when the portfolio is healthy', () => {
    expect(evaluateAutoStop(CONFIG, portfolio())).toEqual({ active: false, reason: null });
  });

  it('treats the drawdown limit as inclusive and ignores a smaller one', () => {
    expect(evaluateAutoStop(CONFIG, portfolio({ drawdownPct: 7.99 })).active).toBe(false);
    expect(evaluateAutoStop(CONFIG, portfolio({ drawdownPct: 8 })).active).toBe(true);
  });

  it('never fires when the loss guard is disabled', () => {
    const config = { ...CONFIG, autoStopLossPct: 0, autoTakeProfitPct: 0, maxDrawdownPct: Number.POSITIVE_INFINITY };
    expect(evaluateAutoStop(config, portfolio({ unrealizedPct: -80 })).active).toBe(false);
  });

  it('arms the stop once and keeps it armed even if the book recovers', () => {
    const stopped = refreshAutoStop(CONFIG, portfolio({ drawdownPct: 20 }), '2026-09-10');
    expect(stopped.autoStop).toEqual({
      active: true,
      reason: 'Drawdown 20% has reached your 8% limit.',
      at: '2026-09-10',
    });
    const recovered = {
      ...stopped,
      drawdownPct: 0,
      equityUsd: 5000,
      peakEquityUsd: 5000,
      unrealizedPct: 0,
    };
    expect(refreshAutoStop(CONFIG, recovered).autoStop).toBe(recovered.autoStop);
    expect(evaluateAutoStop(CONFIG, recovered)).toEqual({
      active: true,
      reason: 'Drawdown 20% has reached your 8% limit.',
    });
    const cleared = clearAutoStop(recovered);
    expect(cleared.autoStop).toEqual({ active: false, reason: null, at: null });
    expect(clearAutoStop(cleared)).toBe(cleared);
  });

  it('returns the same object when nothing changes', () => {
    const state = portfolio();
    expect(refreshAutoStop(CONFIG, state)).toBe(state);
  });
});

describe('portfolio bookkeeping', () => {
  it('applies orders to cash, month spend, positions and the duplicate set', () => {
    const decision = planCopyOrder(trade(), CONFIG, portfolio());
    expect(decision.accepted).toBe(true);
    if (!decision.accepted) throw new Error('expected acceptance');
    const next = applyCopyOrders(portfolio(), [decision.order]);

    expect(next.cashUsd).toBe(3997);
    expect(next.monthSpendUsd).toBe(1000);
    expect(next.positions).toEqual([
      {
        dealId: 'deal-1',
        traderId: 't1',
        openedAt: '2026-09-05',
        investedUsd: 1000,
        currentUsd: 1000,
      },
    ]);
    expect(next.copiedDealIds).toEqual(['deal-1']);
    expect(next.equityUsd).toBe(4997);
    expect(next.followerAumUsd).toBe(4997);
    expect(next.peakEquityUsd).toBe(5000);
    expect(next.drawdownPct).toBe(0.06);
    expect(next.unrealizedPct).toBe(-0.06);
  });

  it('deduplicates copied deal ids when two orders share a deal', () => {
    const order = planCopyOrder(trade(), CONFIG, portfolio());
    if (!order.accepted) throw new Error('expected acceptance');
    const next = applyCopyOrders(portfolio({ copiedDealIds: ['deal-1'] }), [order.order]);
    expect(next.copiedDealIds).toEqual(['deal-1']);
    expect(next.positions).toHaveLength(1);
  });

  it('compounds a 5% mark and re-baselines the peak', () => {
    const decision = planCopyOrder(trade(), CONFIG, portfolio());
    if (!decision.accepted) throw new Error('expected acceptance');
    const opened = applyCopyOrders(portfolio(), [decision.order]);
    const marked = markToMarket(opened, 5);

    expect(marked.positions[0].currentUsd).toBe(1050);
    expect(marked.cashUsd).toBe(3997);
    expect(marked.equityUsd).toBe(5047);
    expect(marked.peakEquityUsd).toBe(5047);
    expect(marked.drawdownPct).toBe(0);
    expect(marked.unrealizedPct).toBe(0.94);

    const dipped = markToMarket(marked, -10);
    expect(dipped.positions[0].currentUsd).toBe(945);
    expect(dipped.equityUsd).toBe(4942);
    expect(dipped.peakEquityUsd).toBe(5047);
    expect(dipped.drawdownPct).toBe(round2(((5047 - 4942) / 5047) * 100));
    expect(dipped.drawdownPct).toBe(2.08);
  });

  it('credits cash when a position closes', () => {
    const decision = planCopyOrder(trade(), CONFIG, portfolio());
    if (!decision.accepted) throw new Error('expected acceptance');
    const opened = applyCopyOrders(portfolio(), [decision.order]);
    const closed = closePosition(opened, 'deal-1');
    expect(closed.positions).toEqual([]);
    expect(closed.cashUsd).toBe(4997);
    expect(closed.equityUsd).toBe(4997);
    expect(closed.copiedDealIds).toEqual(['deal-1']);
    expect(closePosition(closed, 'deal-1')).toBe(closed);
  });

  it('resets the month counter only when the month rolls over', () => {
    const spent = portfolio({ monthSpendUsd: 1500 });
    expect(rolloverMonth(spent, '2026-09-30')).toBe(spent);
    const rolled = rolloverMonth(spent, '2026-10-01');
    expect(rolled.monthKey).toBe('2026-10');
    expect(rolled.monthSpendUsd).toBe(0);
  });

  it('recomputes derived fields without touching cash', () => {
    const recomputed = recomputePortfolio(
      portfolio({ cashUsd: 1000, positions: [{ dealId: 'd', traderId: 't1', openedAt: '2026-09-01', investedUsd: 500, currentUsd: 600 }] }),
    );
    expect(recomputed.equityUsd).toBe(1600);
    expect(recomputed.followerAumUsd).toBe(1600);
    expect(recomputed.peakEquityUsd).toBe(5000);
    expect(recomputed.drawdownPct).toBe(68);
    expect(recomputed.unrealizedPct).toBe(-68);
  });
});

describe('sortTradeEvents', () => {
  it('orders by date then deal id without mutating the input', () => {
    const input = [
      trade({ dealId: 'deal-b', date: '2026-09-10' }),
      trade({ dealId: 'deal-a', date: '2026-09-10' }),
      trade({ dealId: 'deal-c', date: '2026-09-01' }),
    ];
    const sorted = sortTradeEvents(input);
    expect(sorted.map((t) => `${t.date}:${t.dealId}`)).toEqual([
      '2026-09-01:deal-c',
      '2026-09-10:deal-a',
      '2026-09-10:deal-b',
    ]);
    expect(input.map((t) => t.dealId)).toEqual(['deal-b', 'deal-a', 'deal-c']);
  });
});

describe('simulateCopyWindow', () => {
  const WINDOW: CopyTradeEvent[] = [
    trade({ dealId: 'deal-3', date: '2026-10-03', amountUsd: 10_000, realizedRoiPct: -30 }),
    trade({ dealId: 'deal-1', date: '2026-09-05', amountUsd: 10_000, realizedRoiPct: 8 }),
    trade({ dealId: 'deal-4', date: '2026-10-15', amountUsd: 5000, realizedRoiPct: 1 }),
    trade({ dealId: 'deal-2', date: '2026-09-20', amountUsd: 8000, realizedRoiPct: 4 }),
  ];

  // The follower AUM denominator is the follower's own equity, so proportional
  // tickets scale up as the book compounds; the cap is widened to keep the
  // window's binding constraint the monthly allowance rather than the cap.
  const SIM_CONFIG: typeof CONFIG = { ...CONFIG, maxPerTrade: 2000 };

  it('copies, clamps, rolls the month over and then stops for good', () => {
    const result = simulateCopyWindow(WINDOW, SIM_CONFIG, portfolio());

    expect(result.configId).toBe('cfg1');
    expect(result.decisions.map((d) => d.trade.dealId)).toEqual([
      'deal-1',
      'deal-2',
      'deal-3',
      'deal-4',
    ]);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0].code).toBe('AUTO_STOP_ACTIVE');

    expect(result.orders.map((o) => o.amountUsd)).toEqual([1000, 500, 1027.74]);
    expect(result.orders.map((o) => o.feeUsd)).toEqual([3, 1.5, 3.08]);
    expect(result.deployedUsd).toBe(2527.74);
    expect(result.feesUsd).toBe(7.58);

    expect(result.equityCurve).toEqual([
      { date: '2026-08-01', equityUsd: 5000, drawdownPct: 0 },
      { date: '2026-09-05', equityUsd: 5077, drawdownPct: 0 },
      { date: '2026-09-20', equityUsd: 5138.7, drawdownPct: 0 },
      { date: '2026-10-03', equityUsd: 4334.34, drawdownPct: 15.65 },
      { date: '2026-10-15', equityUsd: 4353.03, drawdownPct: 15.29 },
    ]);

    expect(result.simulatedReturnPct).toBe(-12.94);
    expect(result.finalPortfolio.monthKey).toBe('2026-10');
    expect(result.finalPortfolio.monthSpendUsd).toBe(1027.74);
    expect(result.finalPortfolio.cashUsd).toBe(2464.68);
    expect(result.finalPortfolio.positions.map((p) => p.currentUsd)).toEqual([
      794.1, 367.64, 726.61,
    ]);
    expect(result.finalPortfolio.autoStop).toEqual({
      active: true,
      reason: 'Drawdown 15.65% has reached your 8% limit.',
      at: '2026-10-03',
    });
  });

  it('reports the state each decision was taken against', () => {
    const result = simulateCopyWindow(WINDOW, SIM_CONFIG, portfolio());
    const second = result.decisions[1].decision;
    expect(second.accepted).toBe(true);
    if (!second.accepted) throw new Error('expected acceptance');
    // Sized from the marked 5077 follower equity, then clamped to the 500 left.
    expect(second.order.sizedAmountUsd).toBe(812.32);
    expect(second.order.amountUsd).toBe(500);

    const fourth = result.decisions[3].decision;
    expect(fourth.accepted).toBe(false);
    if (fourth.accepted) throw new Error('expected rejection');
    expect(fourth.rejection.details).toMatchObject({
      drawdownPct: 15.65,
      unrealizedPct: -13.31,
    });
  });

  it('rejects an outsized mirror when the per-trade cap binds, then auto-stops', () => {
    const result = simulateCopyWindow(WINDOW, CONFIG, portfolio());
    expect(result.orders.map((o) => o.amountUsd)).toEqual([1000, 500]);
    expect(result.rejections.map((r) => r.code)).toEqual([
      'EXCEEDS_PER_TRADE_LIMIT',
      'AUTO_STOP_ACTIVE',
    ]);
    expect(result.finalPortfolio.equityUsd).toBe(4657.24);
    expect(result.finalPortfolio.drawdownPct).toBe(9.37);
    expect(result.simulatedReturnPct).toBe(-6.86);
  });

  it('rejects every trade when the follower is not following', () => {
    const result = simulateCopyWindow(WINDOW, SIM_CONFIG, portfolio(), { following: false });
    expect(result.orders).toEqual([]);
    expect(result.rejections.every((r) => r.code === 'NOT_FOLLOWING')).toBe(true);
    expect(result.rejections).toHaveLength(4);
    expect(result.deployedUsd).toBe(0);
    expect(result.simulatedReturnPct).toBe(0);
    expect(result.equityCurve.every((p) => p.equityUsd === 5000)).toBe(true);
  });

  it('clamps every ticket to the allowance when marking is disabled', () => {
    const result = simulateCopyWindow(WINDOW, SIM_CONFIG, portfolio(), { markAfterEach: false });
    // Nothing marks to market, so the drawdown stop never fires and deal-4 copies too.
    expect(result.orders.map((o) => o.amountUsd)).toEqual([1000, 500, 999.1, 499.25]);
    expect(result.rejections).toEqual([]);
    expect(result.finalPortfolio.positions.map((p) => p.currentUsd)).toEqual([
      1000, 500, 999.1, 499.25,
    ]);
    expect(result.finalPortfolio.cashUsd).toBe(1992.65);
    expect(result.finalPortfolio.monthSpendUsd).toBe(1498.35);
    expect(result.finalPortfolio.equityUsd).toBe(4991);
    expect(result.finalPortfolio.drawdownPct).toBe(0.18);
    expect(result.finalPortfolio.autoStop.active).toBe(false);
    expect(result.deployedUsd).toBe(2998.35);
    expect(result.feesUsd).toBe(9);
    expect(result.simulatedReturnPct).toBe(-0.18);
  });

  it('takes the whole sized ticket on a wider allowance', () => {
    const wide = { ...CONFIG, maxPerTrade: 5000, monthlyLimit: 5000 };
    const result = simulateCopyWindow([trade({ amountUsd: 30_000 })], wide, portfolio());
    expect(result.rejections).toEqual([]);
    expect(result.orders[0].sizedAmountUsd).toBe(3000);
    expect(result.orders[0].amountUsd).toBe(3000);
    expect(result.orders[0].feeUsd).toBe(9);
    expect(result.finalPortfolio.cashUsd).toBe(1991);
    expect(result.finalPortfolio.monthSpendUsd).toBe(3000);
  });

  it('stops copying once the take-profit target is reached', () => {
    const config = { ...CONFIG, autoTakeProfitPct: 1 };
    const result = simulateCopyWindow(WINDOW, config, portfolio());
    expect(result.orders.map((o) => o.amountUsd)).toEqual([1000]);
    expect(result.rejections.map((r) => r.code)).toEqual([
      'AUTO_STOP_ACTIVE',
      'AUTO_STOP_ACTIVE',
      'AUTO_STOP_ACTIVE',
    ]);
    expect(result.finalPortfolio.autoStop.reason).toBe(
      'Unrealised gain 1.54% reached your +1% target.',
    );
    expect(result.finalPortfolio.autoStop.at).toBe('2026-09-05');
  });
});

describe('validateCopyConfig', () => {
  it('accepts a coherent configuration', () => {
    expect(validateCopyConfig(CONFIG)).toEqual([]);
  });

  it('requires positive limits and flags an impossible floor', () => {
    const errors = validateCopyConfig({
      ...CONFIG,
      minTradeValue: -1,
      maxPerTrade: 0,
      monthlyLimit: 0,
    });
    expect(errors.map((e) => e.path).sort()).toEqual(['maxPerTrade', 'minTradeValue', 'monthlyLimit']);
    expect(errors).toContainEqual({
      path: 'minTradeValue',
      message: 'Minimum trade size must be zero or more.',
    });
  });

  it('catches a per-trade cap below the minimum and a monthly limit below the cap', () => {
    const errors = validateCopyConfig({
      ...CONFIG,
      minTradeValue: 500,
      maxPerTrade: 200,
      monthlyLimit: 100,
    });
    expect(errors).toContainEqual({
      path: 'maxPerTrade',
      message: 'Per-trade cap must be at least the minimum trade size.',
    });
    expect(errors).toContainEqual({
      path: 'monthlyLimit',
      message: 'Monthly limit must be at least the minimum trade size.',
    });
    expect(errors).toContainEqual({
      path: 'monthlyLimit',
      message: 'Monthly limit cannot be lower than the per-trade cap.',
    });
  });

  it('validates the mode-specific field only', () => {
    expect(
      validateCopyConfig({ ...CONFIG, mode: 'fixed', fixedAmountUsd: 0 }).map((e) => e.path),
    ).toEqual(['fixedAmountUsd']);
    expect(
      validateCopyConfig({ ...CONFIG, mode: 'fixed', fixedAmountUsd: 5000, maxPerTrade: 1000 }),
    ).toEqual([{ path: 'fixedAmountUsd', message: 'Fixed amount exceeds the per-trade cap.' }]);
    expect(
      validateCopyConfig({ ...CONFIG, allocationPct: 0 }).map((e) => e.path),
    ).toEqual(['allocationPct']);
    expect(
      validateCopyConfig({ ...CONFIG, mode: 'inverse_risk', riskBudgetPct: 150 }).map(
        (e) => e.path,
      ),
    ).toEqual(['riskBudgetPct']);
  });

  it('bounds the risk guards', () => {
    const errors = validateCopyConfig({
      ...CONFIG,
      autoStopLossPct: 200,
      autoTakeProfitPct: 600,
      maxDrawdownPct: 0,
    });
    expect(errors).toEqual([
      { path: 'autoStopLossPct', message: 'Stop-loss must be between 0% and 100%.' },
      { path: 'autoTakeProfitPct', message: 'Take-profit must be between 0% and 500%.' },
      { path: 'maxDrawdownPct', message: 'Max drawdown must be between 1% and 100%.' },
    ]);
  });

  it('treats missing fields as invalid rather than infinite', () => {
    expect(validateCopyConfig({ mode: 'proportional' }).map((e) => e.path)).toEqual([
      'minTradeValue',
      'maxPerTrade',
      'monthlyLimit',
      'allocationPct',
      'autoStopLossPct',
      'autoTakeProfitPct',
      'maxDrawdownPct',
    ]);
  });
});

describe('makeCopyConfig and config storage helpers', () => {
  it('seeds a conservative proportional default', () => {
    const config = makeCopyConfig('f9', 't9');
    expect(config).toMatchObject({
      id: 'copycfg:f9:t9',
      followerId: 'f9',
      traderId: 't9',
      mode: 'proportional',
      allocationPct: 100,
      feeBps: 30,
      blacklist: [],
      notifications: true,
      enabled: true,
      derivedFromStrategyId: null,
    });
    expect(validateCopyConfig(config)).toEqual([]);
  });

  it('applies overrides and keeps the ISO timestamps', () => {
    const config = makeCopyConfig('f1', 't1', { mode: 'fixed', blacklist: ['Cocoa'] });
    expect(config.mode).toBe('fixed');
    expect(config.blacklist).toEqual(['Cocoa']);
    expect(config.updatedAt).toBe(config.createdAt);
  });

  it('inserts, replaces and removes configs by id', () => {
    const first = makeCopyConfig('f1', 't1', { id: 'a' });
    const second = makeCopyConfig('f1', 't2', { id: 'b' });
    const list = upsertCopyConfig([first], second);
    expect(list.map((c) => c.id)).toEqual(['a', 'b']);
    expect(upsertCopyConfig(list, { ...second, allocationPct: 40 })).toEqual([
      first,
      { ...second, allocationPct: 40 },
    ]);
    expect(removeCopyConfig(list, 'a').map((c) => c.id)).toEqual(['b']);
  });
});
