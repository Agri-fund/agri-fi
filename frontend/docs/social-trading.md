# Social Trading & Copy Trading

GitHub issue #1212 asked for trader profiles, a follow graph, copy trading with hard risk controls, performance leaderboards, strategy sharing, community discussions, mandatory risk warnings and copy-performance analytics. All of it is implemented in `frontend/src/lib/social-trading/` as pure, deterministic TypeScript that runs entirely in the browser: the copy engine sizes and vets every mirrored ticket against follower-set limits, the risk assessor turns a trader's track record plus a copy configuration into a 0-100 score with concrete warnings, and the analytics module measures fidelity and slippage of the copies against the leader. This document describes what the code actually does — every constant, formula and threshold below is lifted from the implementation and cross-checked against the unit tests that pin it.

---

## Overview

| Capability (issue requirement) | Description | Where |
| --- | --- | --- |
| **Trader profiles** | Risk-adjusted performance record built from a monthly return series plus deals/investments: Sharpe, Sortino, Calmar, drawdown, volatility, consistency, exposures, default rate. | `profiles.ts`, `buildTraderProfile` |
| **Follow graph** | Versioned `{follower, trader}` edges with dedup, mutual-follow detection, follower counts and weighted trader suggestions. | `follow.ts` |
| **Copy trading** | Pure decision engine: a leader `CopyTradeEvent` + `CopyConfig` + `PortfolioState` yields a sized `CopyOrder` or a machine-readable rejection. | `copy-trading.ts`, `planCopyOrder` |
| **Copy controls** | Sizing modes, minimum ticket, per-trade cap, monthly allowance, blacklist, duplicate guard, drawdown / stop-loss / take-profit auto-stop, fees. | `CopyConfig`, `validateCopyConfig` |
| **Leaderboards** | Six metrics over five windows, eligibility filters, deterministic tie-breaks, Platinum/Gold/Silver/Bronze tier badges, trend and sparkline. | `leaderboard.ts` |
| **Strategy sharing** | Zod-validated strategy authoring with allocations, versioning/changelog and a `SharedStrategy` -> `CopyConfig` subscription mapping. | `strategy-sharing.ts` |
| **Community discussions** | Deal/strategy/trader-scoped threads, nested replies with a depth cap, votes, pinning, moderation flags, hot/recent/top sorting, key-insight extraction. | `discussions.ts` |
| **Risk warnings** | Weighted 0-100 composite risk score over six factors plus 23 coded warnings with severity and mitigation text. | `risk-warnings.ts` |
| **Copy analytics** | Success rate, median/average returns, slippage, Pearson fidelity, tracking error, profit factor, PnL attribution, copy-vs-organic verdict. | `copy-analytics.ts` |
| **UI** | `/social` route with a six-tab dashboard wiring every module together. | `SocialTradingDashboard.tsx` |
| **Documentation & tests** | This document plus eight vitest suites pinning the numbers. | `__tests__/` |

---

## Architecture

```
                          leader trades (CopyTradeEvent[])
                                      |
                                      v
        +--------------------- copy-trading.ts ---------------------+
        |  guards: INVALID_INPUT -> COPY_DISABLED -> NOT_FOLLOWING  |
        |          -> BLACKLISTED -> DUPLICATE -> AUTO_STOP_ACTIVE  |
        |  sizing: sizeCopyTrade (proportional/fixed/inverse_risk)  |
        |  caps:   min ticket -> per-trade cap -> monthly allowance |
        |          -> available cash (fees included)                |
        +---------------------------+-------------------------------+
                                    |  CopyDecision (order | rejection)
                                    v
   PortfolioState  <-- applyCopyOrders / markToMarket / closePosition / rolloverMonth
        |                                   |
        | simulateCopyWindow (dry run)      | settled CopyResult[]
        v                                   v
   equityCurve, deployed, fees        copy-analytics.ts  (aggregate, compareCopyVsOrganic)

   follow.ts (graph + suggestions)   leaderboard.ts   risk-warnings.ts   discussions.ts
              \                        |       \            /               /
               \                       v        v          v               v
                +--> useSocialTrading / useCopyTrading (React hooks) <-----+
                                        |
                                        v
        SocialTradingDashboard: Leaderboard | Trader profiles | Copy trading |
                                Strategies | Discussions | Analytics   (/social route)

   Persistence boundaries (localStorage, SSR-safe, fail-inert):
     agrifi.social-trading.follow.v1      -> follow graph      (follow.ts)
     agrifi.social-trading.copy-configs.v1 -> CopyConfig[]     (copy-trading.ts)
   Everything else (portfolio, discussions, strategies, analytics) is in-memory
   state seeded from sample-data.ts fixtures.
```

The two hooks are the only React layer: `useSocialTrading` owns profiles, follow state, leaderboard selection (`metric`/`window`/`region`) and per-trader risk assessments; `useCopyTrading` owns the selected trader's config, the demo portfolio, the live dry-run simulation and the analytics aggregates.

---

## Risk-adjusted metrics methodology (`profiles.ts`)

Conventions enforced by the code and its tests:

| Convention | Rule in the code |
| --- | --- |
| Return series | Monthly, decimal fractions (0.015 = 1.5%). |
| Dispersion | **Sample** standard deviation: sum of squared deviations divided by `n - 1`; returns 0 for fewer than two points. |
| Downside deviation | RMS of shortfalls against a 0% MAR over *all* periods: `sqrt(sum(min(r, 0)^2) / n)` — no separate count of losing months. |
| Risk-free rate | Compounded: monthly `rf = (1 + annual rf)^(1/12) - 1` (`monthlyRiskFreeRate`), subtracted from the monthly mean once to form the excess. |
| Sharpe | `(mean - rf_monthly) / stdev * sqrt(12)` (`MONTHS_PER_YEAR = 12`); 0 when stdev is 0. |
| Sortino | `(mean - rf_monthly) / downside * sqrt(12)`; when a window has no losing periods the downside is 0 and the metric falls back to the Sharpe (finite, never flattering). |
| Volatility | `stdev * sqrt(12)` (annualised). |
| Max drawdown | Peak-to-trough walk on the compounded equity curve (start 1, `equity *= 1 + r`, track `peak = max(peak, equity)`), reported as a positive magnitude `(peak - equity) / peak`. |
| Calmar | Geometric annualised return `(1 + total)^(12/n) - 1` divided by `max(maxDrawdown, 0.01)` — a documented **1% floor** so a near-flat curve cannot produce enormous ratios that dominate the leaderboard. |
| Rounding | All five metrics rounded to 4 decimals (`round(value, 4)`); percentage-point outputs elsewhere use 2. |

### Worked example A — `[0.01, 0.02, 0.03]`

- Mean 0.02; squared deviations sum to 0.0002; sample stdev = `sqrt(0.0002 / 2)` = 0.01; volatility = `0.01 * sqrt(12)` = **0.0346**.
- Sharpe with `rf = 0`: `0.02 / 0.01 * sqrt(12)` = **6.9282** (test asserts `toBeCloseTo(6.9282)`).
- Sharpe with 3% annual rf: monthly `rf = 1.03^(1/12) - 1 = 0.00246627`; excess 0.01753373; ratio `* sqrt(12)` = **~6.0735** (test asserts this value).
- No losing month -> downside deviation 0 -> Sortino falls back to the Sharpe, 6.9282.
- Equity only rises -> max drawdown 0 -> Calmar = annualised `(1.0611)^(12/3) - 1 = 0.2678` over the 1% floor = **26.7754**.
- Consistency score (below): 3/3 positive, volatility leg `1 - 0.0346/0.3`, tail leg `1 - 0.01/0.1` -> **95.11**.

### Worked example B — `SWING = [0.1, -0.1, 0.1, -0.1]` (the test fixture)

- Equity walk: 1 -> 1.1 -> 0.99 -> 1.089 -> 0.9801; peak 1.1; max drawdown `(1.1 - 0.9801) / 1.1` = **0.109**.
- Volatility `sqrt(0.04/3) * sqrt(12)` = **0.4** exactly; mean 0 and rf 0 -> Sharpe and Sortino both **0**.
- Calmar: annualised `0.9801^3 - 1 = -0.05846` over 0.109 -> **-0.5369**.
- Downside deviation `sqrt((0.01 + 0.01) / 4)` = 0.070711 (asserted to 8 dp).

---

## Trader profiles & the consistency score

`buildTraderProfile(trader: TraderIdentity, deals, investments, {asOf, riskFreeAnnual})` combines identity (display name, bio, strategy summary, focus sectors, regions, `joinedAt`, `verified`, `aumUsd`, `followerCount`) with:

- `performance`: `buildPerformanceHistory` turns the monthly series into `{period, returnPct, cumulativePct, equityIndex}` points labelled from `firstReturnPeriod` (`YYYY-MM`, rolling across the year boundary); `sparkline` is the `cumulativePct` list.
- `metrics` (`computeMetrics`): cumulative return compounds the series; realized ROI sums `amount * return_percentage / 100` over **settled** investments (`return_percentage` not null) divided by their cost; win rate = profitable settled / settled; average holding days from `created_at` to `deal.delivery_date`; exposures are value-weighted commodity shares over all investments; `defaultRatePct` = failed deals / all deals; `tenureMonths` = whole calendar months between `joinedAt` and `asOf` (`monthsBetween`, 33 months for 2024-01-15 -> 2026-10-15).

Consistency score (0-100, weights in `CONSISTENCY_WEIGHTS`):

```
score = 0.55 * positiveMonthRate
      + 0.25 * (1 - min(annualVol / MAX_ANNUAL_VOLATILITY(0.3), 1))
      + 0.20 * (1 - min(|worstMonth| / MAX_WORST_MONTH(0.1), 1))
```

clamped to 0..1, scaled by 100, rounded to 2. An empty series is 0; the all-losing fixture `[-0.2, -0.2]` scores exactly **25** (zero positive leg, zero volatility leg 1.0 -> 0.25, saturated tail leg).

`sample-data.ts` builds 8 profiles (`trader-amina`, `trader-koji`, `trader-chidi`, `trader-tunde`, `trader-marta`, `trader-ife`, `trader-ba`, `trader-ravi`) as of `SAMPLE_AS_OF = 2026-10-01`; the riskiest, `trader-ravi`, has a 29.15% max drawdown while the flattest has 0.

---

## Copy-trading decision flow (`copy-trading.ts`)

### Sizing per mode (`sizeCopyTrade`, before any cap)

| Mode | Ticket size |
| --- | --- |
| `proportional` | `followerAum * (leaderTicket / leaderAum) * allocationPct / 100`; 0 when `leaderAum <= 0`. |
| `fixed` | `fixedAmountUsd`, flat, regardless of the leader ticket. |
| `inverse_risk` | `followerAum * (riskBudgetPct / 100) * RISK_MULTIPLIERS[riskRating]`, with `RISK_MULTIPLIERS = { Low: 1, Medium: 0.6, High: 0.3 }`. |

### Guard and cap order (earlier short-circuits later)

`INVALID_INPUT -> COPY_DISABLED -> NOT_FOLLOWING (context.following or follower-id mismatch) -> BLACKLISTED (case-insensitive match on dealId, commodity or region) -> DUPLICATE (deal already in copiedDealIds) -> AUTO_STOP_ACTIVE -> sizing -> BELOW_MINIMUM (min ticket) -> MONTHLY_LIMIT_REACHED (allowance exhausted or leftover < min) -> EXCEEDS_PER_TRADE_LIMIT -> monthly partial clamp `amount = min(sized, remainingAllowance)` -> INSUFFICIENT_BALANCE (cash < amount + fee)`.

The per-trade cap is a hard reject (silently shrinking a proportional mirror breaks copy fidelity); the monthly allowance is clamped to a partial fill instead; cash is a reject, not a clamp. `DEFAULT_FEE_BPS = 30` (0.30%) is charged on every ticket: `fee = round2(amount * bps / 10_000)`.

### Auto-stop

`evaluateAutoStop` fires when (1) the sticky flag is already set, (2) `drawdownPct >= maxDrawdownPct` (inclusive), (3) `unrealizedPct <= -autoStopLossPct`, or (4) `unrealizedPct >= autoTakeProfitPct`; a `<= 0` guard (or infinite drawdown) disables that leg. `refreshAutoStop` arms the flag; **auto-stop is deliberately sticky** — a recovering book does not silently resume mirroring, and only `clearAutoStop` (the UI "resume copying" action) resets it. `rolloverMonth` zeroes `monthSpendUsd` when the `YYYY-MM` key changes.

### Worked example (the test's own fixture)

Config `maxPerTrade 1000, monthlyLimit 1500, minTradeValue 100, allocationPct 100`; portfolio cash 5000, follower AUM 5000, leader AUM 50000.

- Leader ticket 10,000 (Coffee, Low): sized `5000 * (10000/50000) = 1000`; cap is inclusive so it is accepted at 1000; fee 3.00; order id `copy:cfg1:deal-1`, status `planned`.
- Leader ticket 8,000 with 1,200 already spent this month: sized 800, allowance `1500 - 1200 = 300` binds -> partial fill **300**, fee 0.90.
- Allocation 9% (sized 90 < 100 floor) -> `BELOW_MINIMUM`, `proposedAmountUsd 90`; High-risk inverse-risk ticket sizes 75 -> also `BELOW_MINIMUM`; a 50,000 leader ticket sized to 5000 -> `EXCEEDS_PER_TRADE_LIMIT` (details carry `maxPerTrade 1000`); cash 900 against 1000 + 3 fee -> `INSUFFICIENT_BALANCE (requiredUsd 1003)`.

`makeCopyConfig` defaults: proportional, allocationPct 100, fixed 500, riskBudget 5, per-trade 2,000, monthly 10,000, min 100, stop-loss 10%, take-profit 25%, max drawdown 15%, feeBps 30, notifications on, enabled, blacklist empty.

### Rejection codes (`REJECTION_MESSAGES`, full table)

| Code | Message |
| --- | --- |
| `INVALID_INPUT` | The trade or copy settings are not valid. |
| `COPY_DISABLED` | Copy trading is switched off for this trader. |
| `NOT_FOLLOWING` | You are not following this trader. |
| `BLACKLISTED` | This deal matches an entry on your copy blacklist. |
| `DUPLICATE` | You already hold a copy of this deal. |
| `AUTO_STOP_ACTIVE` | Auto-stop is active, so copying is paused. |
| `BELOW_MINIMUM` | The copied ticket falls below your minimum trade size. |
| `MONTHLY_LIMIT_REACHED` | You have used up this month's copy allowance. |
| `EXCEEDS_PER_TRADE_LIMIT` | The leader ticket exceeds your per-trade cap. |
| `INSUFFICIENT_BALANCE` | Not enough available balance to copy this trade. |

`validateCopyConfig` applies the same rules to the form: positive finite limits, `maxPerTrade >= minTradeValue`, `monthlyLimit >=` both, mode-specific field in 1..100 (fixed must fit under the cap), stop-loss 0-100, take-profit 0-500, max drawdown 1-100.

---

## Risk warning methodology (`risk-warnings.ts`)

Composite score = sum of `weight * subscore` over six factors (each subscore 0-100, `scaled = clamp(observed / saturation) * 100`), rounded to 2 and clamped 0-100. `RISK_WEIGHTS` (sum 1):

| Factor | Weight | Observed value | Saturation (`RISK_SATURATION`) |
| --- | --- | --- | --- |
| Sector concentration | 0.18 | `topExposurePct` | 80% |
| Historical max drawdown | 0.20 | `maxDrawdownPct` | 40% |
| Return dispersion & hit rate | 0.15 | `0.5 * (100 - winRate) + 0.5 * (volatilityPct / 30)` | win 0% & vol 30% |
| Short tenure (inverted) | 0.12 | `1 - tenureMonths / 36` | 36 months -> 0 |
| Deal default rate | 0.18 | `defaultRatePct` | 25% |
| Copy-config aggressiveness | 0.17 | weighted breakdown below | — |

Aggressiveness (`AGGRESSIVENESS_WEIGHTS`): size concentration `clamp(maxPerTrade / monthlyLimit)` at 0.35; budget aggression (`allocationPct/100`, or `fixed/monthly`, or `riskBudgetPct/20`) at 0.25; weak controls — mean of stop leg `clamp((25 - stopLoss)/25)` and drawdown leg `clamp((30 - maxDrawdown)/30)`, each pinned to 100 when disabled — at 0.25; empty blacklist 100 at 0.15. Tests: the safe default config scores 29.75, a reckless one saturates at 100.

Tiers (`RISK_TIER_THRESHOLDS = { low: 25, moderate: 45, elevated: 65 }`): score < 25 low, < 45 moderate, < 65 elevated, else high. Example assessments: 15.06 -> low, 22.56 -> low, 96.42 -> high.

`collectRiskWarnings` emits coded warnings (severity, trigger threshold): `HIGH_CONCENTRATION` critical >= 55% / `CONCENTRATION_WATCH` warning >= 35%; `DEEP_DRAWDOWN` critical >= 25% / `DRAWDOWN_RISK` warning >= 15%; `VOLATILE_TRACK_RECORD` warning vol >= 20%; `LOW_WIN_RATE` critical < 45% / `MODEST_WIN_RATE` warning < 55%; `COLD_TRACK_RECORD` critical < 6 months / `SHORT_TENURE` warning < 12; `HIGH_DEFAULT_RATE` critical >= 10% / `DEFAULT_RATE_ELEVATED` warning >= 5%; `UNVERIFIED_TRADER` info; `LEVERAGED_COPYING` critical (allocation > 100%); `CONCENTRATED_ALLOWANCE` warning (cap >= half the monthly limit); `NO_STOP_LOSS`, `NO_DRAWDOWN_STOP`, `ENTRY_SLIPPAGE` (avg > 0.5%), `LOW_COPY_FIDELITY` (r < 0.6), `LOW_COPY_SUCCESS_RATE` (< 45% over >= 5 copies) warnings; `EMPTY_BLACKLIST`, `COPY_DISABLED`, `INSUFFICIENT_COPY_HISTORY` (< 5 settled) info; `NEGATIVE_EDGE` critical (profit factor < 1). Every warning carries a mitigation string, e.g. DEEP_DRAWDOWN: "Set max drawdown auto-stop at or below half of that figure."

---

## Leaderboards (`leaderboard.ts`)

`LEADERBOARD_METRICS` = keys of `METRIC_LABELS`: `roi` ("Total ROI"), `sharpe` ("Sharpe ratio"), `sortino` ("Sortino ratio"), `calmar` ("Calmar ratio"), `winRate` ("Win rate"), `consistency` ("Consistency score"); units are percent for roi/winRate/consistency, ratio otherwise. Windows are `SocialMetricWindow = '1m' | '3m' | '6m' | '12m' | 'all'`, sliced from the trailing months of each profile's raw series; default board = `roi` over `12m`. Windowed values recompute Sharpe/Sortino/Calmar/consistency on the slice; win rate stays on settled deals (a short window may contain none).

Eligibility (`DEFAULT_LEADERBOARD_RULES = { minTenureMonths: 3, minAumUsd: 0, limit: 50, tierCutoffs: { platinum: 0.15, gold: 0.4, silver: 0.7 } }`): tenure >= 3 months, AUM >= floor, a non-empty return series, and the optional region filter (case-insensitive membership in `profile.regions`).

Tie-break order (`compareEntries`, deterministic): 1) metric value desc, 2) window ROI desc, 3) AUM desc, 4) tenure desc, 5) trader id asc. Tier badges use percentile cutoffs of the sorted board (`index / total`): top 15% Platinum, then Gold to 40%, Silver to 70%, Bronze after (an 8-row board yields P, P, G, G, S, S, B, B). Entries also carry `trendPct` (compounded change over the last three periods, max 3), sparkline, verified flag and the linked `riskScore`/`riskTier` from the hook's assessments.

---

## Strategy sharing (`strategy-sharing.ts`)

`strategySchema` (zod) bounds: `authorId` min 1; `authorName` min 2; `title` 8-120; `summary` 20-320; `thesis` 40-4000; `targetRoiPct` 0-100; `maxRiskScore` 0-100; `horizonDays` int 30-1095; `allocations` 1-8 items of `{sector min 2 chars, weightPct 1-100}`; `regions` 1-6; `excludedCommodities` <= 12; `tags` <= 8; plus a `copyTemplate` schema mirroring the engine's limits (allocation/risk budget 1-100, positive per-trade and monthly, min >= 0, stop 0-100, take-profit 0-500, drawdown 1-100).

Business rules beyond zod (`validateStrategy`): allocation weights must total exactly `STRATEGY_ALLOCATIONS_TOTAL_PCT = 100`; a sector may appear only once; `monthlyLimit >= maxPerTrade`; `minTradeValue <= maxPerTrade`; template drawdown stop <= `maxRiskScore`; a target above 25% ROI requires a risk bound of at least 40.

Versioning: `publishStrategy` creates `id = strategy:<slug>-v1`, version 1, changelog `[{version: 1, changes: 'Initial publication.', at}]`; `reviseStrategy` bumps the version, merges the partial revision, appends a changelog entry and keeps the id stable (v3 keeps all three entries); `archiveStrategy` flips status (`'draft' | 'published' | 'archived'`) without touching the changelog. `subscribeToStrategy` maps the template into a `CopyConfig`: id `copycfg:<followerId>:<authorId>` (`traderId` may be overridden), all sizing/cap fields copied verbatim, `feeBps: 30`, `blacklist: [...excludedCommodities]`, `maxDrawdownPct: min(template.maxDrawdownPct, strategy.maxRiskScore)` (a strategy never loosens its own bound), `derivedFromStrategyId: strategy.id`, and `enabled: false` — subscribing is intent, the follower must still accept the risk warnings. The test pins the mapping: allocationPct 60, per-trade 800, monthly 2400, min 50, stop 15, take-profit 40, drawdown 20, blacklist `['Tobacco']`. The feed sorts published strategies by `hot` (Reddit-style `strategyHotScore = log10(max(subscribers, 1) + 1) * 20 + max(0, 30 - ageDays)`, round 2), `recent`, `followers` or `roi`, each with deterministic id tie-breaks.

---

## Community discussions (`discussions.ts`)

Threads are scoped `'deal' | 'strategy' | 'trader'` via `{scopeType, scopeId}`. Replies nest up to `MAX_REPLY_DEPTH = 3`; a deeper reply is re-parented to its deepest allowed ancestor so the rendered tree never exceeds the cap (cross-thread parents are dropped to root). Votes are idempotent per user (`voteThread` / `voteComment` toggle). Sorting: `hot` (default), `recent` (by `lastActivityAt`), `top` (by `threadPoints = upvotes + COMMENT_VOTE_WEIGHT (2) * commentCount`); pinned threads always come first, flagged threads are excluded unless `includeFlagged`. Hot score:

```
hotScore = sign(points) * log10(max(|points|, 1))
         + (createdAt - HOT_EPOCH_MS) / 1000 / HOT_GRAVITY_SECONDS
```

with `HOT_EPOCH_MS = Date.UTC(2026, 0, 1)` and `HOT_GRAVITY_SECONDS = 45_000` (12.5 h), rounded to 3 — fixed epoch keeps it deterministic. `flagForModeration` marks a thread or comment with a trimmed reason; `resolveModeration` clears both. `highlightKeyInsights` returns the most-upvoted non-flagged comments (default 1 per thread, min 1 upvote) as `{threadId, comment}` TL;DR rows; `commentTree` builds the reply tree and `treeDepth` reports the deepest level actually present.

---

## Copy analytics (`copy-analytics.ts`)

Per `CopyResult` (a settled copy with both sides' outcomes and entry prices): success = `followerReturnPct > 0`; **slippage** = `(followerEntryPrice - leaderEntryPrice) / leaderEntryPrice * 100` (positive = entered worse); holding days = whole days between `openedAt` and `closedAt`. `aggregate` over the results yields: `successRatePct`, `beatLeaderRatePct` (share with follower return >= leader return), mean and **median** returns (even-length medians average the two middles), avg win/loss, avg/worst slippage, `fidelity = pearson(followerReturns, leaderReturns)` to 4 dp (0 when either series has no variance or fewer than two points), `trackingErrorPct = sample stdev of (follower - leader)` (n-1 rule shared with `profiles.ts`), total/gross PnL, `profitFactor = grossProfit / grossLoss` (null when loss-free), fees, average holding, `monthly` buckets, `bestCopy`/`worstCopy`, and `attribution` grouped by `'trader'` (default) | `'commodity'` | `'region'` with `contributionPct = |group pnl| / sum|pnl| * 100`, sorted by PnL desc then key.

On the `SAMPLE_COPY_RESULTS` fixture (5 settled copies) the tests pin: success rate **60.00%**, avg return **2.41%**, median **3.1%**, avg slippage **0.92%** (worst **1.43%**), fidelity **0.987**, tracking error **0.77**, total PnL **$190.60**, profit factor **5.89**, avg holding **22.8 days**; re-recording the same `copyId` replaces rather than duplicates. `compareCopyVsOrganic` diffs two aggregates: verdict `copying_ahead` when the success-rate or avg-return delta exceeds **+0.5**, `copying_behind` below **-0.5**, else `even` with a one-line summary. Sample comparison: copies 60% vs organic 50% success (-1.2% avg, PF 0.56) -> `copying_ahead`.

---

## UI

Route: `src/app/[locale]/social/page.tsx` (client component, wrapped in `Suspense`) renders `SocialTradingDashboard` at `/<locale>/social`; `?trader=<id>` deep-links preselect a trader. Tabs: **Leaderboard**, **Trader profiles**, **Copy trading**, **Strategies**, **Discussions**, **Analytics**.

| Component | Role |
| --- | --- |
| `SocialTradingDashboard.tsx` | Tab shell; composes `useSocialTrading` + `useCopyTrading`; subscribing to a strategy calls `subscribeToStrategy` and pushes the config into the copy tab via `applyStrategyConfig`. |
| `LeaderboardTable.tsx` | Metric/window/region pickers, ranked rows with tier badges, trend arrows, sparklines, risk tier column. |
| `TraderProfileCard.tsx` / `TraderProfileDetail.tsx` | Profile cards and the detail pane (metrics, exposures, performance, follow state, embedded `CopyRiskWarnings`); exports `RiskTierBadge`. |
| `FollowButton.tsx` | Follow/unfollow toggle with follower counts (icons `UserCheck`/`UserPlus`). |
| `CopyTradingControls.tsx` | Config form with per-field errors from `validateCopyConfig`, dry-run order/rejection list rendering `REJECTION_MESSAGES`, auto-stop status and resume action, save/submit buttons. |
| `StrategyFeed.tsx` / `StrategyShareCard.tsx` | Sorted strategy list with validation state and subscribe button. |
| `DiscussionForum.tsx` / `DiscussionThreadItem.tsx` | Thread list with sort tabs, create/vote/pin/flag actions, nested comment tree capped at `MAX_REPLY_DEPTH`, key-insight column. |
| `CopyAnalyticsPanel.tsx` | Recharts visualisations of equity/return, slippage, attribution and the copy-vs-organic comparison. |

---

## Current scope & limits

All state is client-side. The follow graph and copy configs persist in localStorage (`agrifi.social-trading.follow.v1`, `agrifi.social-trading.copy-configs.v1`, both SSR-safe and inert when storage fails); the demo portfolio, discussions and strategies live only in React state seeded from `sample-data.ts` (`DEMO_PORTFOLIO`: 18,000 cash + one cocoa position, 20,000 starting equity). There is **no order routing or settlement**: accepted orders stay `status: 'planned'`, `CopyTradeEvent.realizedRoiPct` is a fixture input to the simulator, and nothing talks to the network.

### Wiring a backend / on-chain settlement

The repo's existing pattern is Next.js route handlers wrapped in `withBackendProxy` (`src/lib/api-proxy.ts`): the handler describes `{path, method, headers, body, status, forwardAuth}` and the helper calls `fetchBackend` (from `src/config/backend`), forwards the `Authorization` header by default, and maps an unreachable backend to 503 / other errors to 500. Concrete seams:

1. **Trade feed** — replace the `SAMPLE_LEADER_TRADES` filter in `useCopyTrading.trades` with a proxied `GET /social-traders/<id>/trades`; nothing downstream changes because `planCopyOrder` is pure over `CopyTradeEvent`.
2. **Order submission** — `submitOrders` currently applies orders locally via `applyCopyOrders`; a NestJS (or Soroban) settlement layer plugs in by POSTing the `CopyOrder[]` (the engine's id format `copy:<configId>:<dealId>` doubles as an idempotency key) and transitioning `CopyOrderStatus` `planned -> submitted -> filled`, which the type already reserves.
3. **Graph/config persistence** — swap `loadFollowGraph`/`saveFollowGraph` and `loadCopyConfigs`/`saveCopyConfigs` for proxied REST calls; the store/load pairs are the only I/O in the whole library.
4. **Profiles, leaderboard, analytics** — `buildSampleProfiles` is the single data source consumed by `useSocialTrading`; server-computed monthly return series can feed `buildTraderProfile` unchanged.
5. **Forum and strategies** — the `{threads, comments}` store and `SharedStrategy` objects are plain serialisable data, ready for a `/social-discussions` and `/social-strategies` proxy.

---

## File map

| Path (under `frontend/src/`) | Purpose |
| --- | --- |
| `lib/social-trading/types.ts` | All shared interfaces and unions (no runtime code). |
| `lib/social-trading/profiles.ts` | Risk-adjusted math, performance history, consistency, metrics, profile builder. |
| `lib/social-trading/follow.ts` | Follow graph, normalisation, mutuals, weighted suggestions, localStorage. |
| `lib/social-trading/copy-trading.ts` | Sizing, guards, caps, auto-stop, simulator, config validation/persistence. |
| `lib/social-trading/leaderboard.ts` | Metric boards, eligibility, tie-breaks, tier badges, trend. |
| `lib/social-trading/risk-warnings.ts` | Factor weighting, subscores, tiers, coded warnings, assessment. |
| `lib/social-trading/strategy-sharing.ts` | Zod schema, validation, versioning, subscribe mapping, feed sort. |
| `lib/social-trading/discussions.ts` | Threads/comments store, hot score, votes, moderation, insights, tree. |
| `lib/social-trading/copy-analytics.ts` | Aggregation, Pearson fidelity, slippage, attribution, copy-vs-organic. |
| `lib/social-trading/sample-data.ts` | 8 trader seeds, deals/investments, trades, results, configs, strategies, forum fixtures. |
| `hooks/useSocialTrading.ts` | Profiles, follow state, board selection, suggestions, assessments. |
| `hooks/useCopyTrading.ts` | Config editing, dry-run simulation, portfolio actions, analytics. |
| `components/social-trading/*.tsx` | The dashboard tabs and components listed above. |
| `app/[locale]/social/page.tsx` | Route entry point. |

---

## Testing

Eight vitest suites under `lib/social-trading/__tests__/` pin the behaviour described here (approximate `it()` case counts): `profiles.test.ts` (23 — metric conventions and the two worked examples above), `copy-trading.test.ts` (66 — every rejection path, cap order, sticky auto-stop, simulation), `discussions.test.ts` (45 — depth cap, hot ordering, moderation), `strategy-sharing.test.ts` (39 — schema bounds, changelog, subscribe mapping), `follow.test.ts` (24), `leaderboard.test.ts` (24 — windows, tie-breaks, tier bands), `risk-warnings.test.ts` (24 — subscores, tiers, warnings), and `copy-analytics.test.ts` (23 — aggregate and comparison numbers). The suites run against the local test setup only; per the repo's rules they are not executed as part of writing this document.

## How to extend

New leaderboard metrics: add a key to `METRIC_LABELS` (units in `METRIC_UNITS`) and a branch in `windowedMetricValue`. New sizing modes: extend `CopyMode` and `sizeCopyTrade`, then the mode-specific branch in `validateCopyConfig`. New warnings: add a branch in `collectRiskWarnings` with a code, severity and mitigation, and pin it in `risk-warnings.test.ts`. New rejection codes: extend `CopyRejectionCode` in `types.ts` and add the mandatory message to `REJECTION_MESSAGES` (the `Record` type makes a missing entry a compile error).
