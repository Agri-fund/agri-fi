# Algorithmic Trading Strategies

## Overview

Investor strategies define filters for discovering deals and a recurring budget for evaluating matches. The current implementation extends auto-invest plans with named criteria, templates, community visibility, version snapshots, and historical deal backtests. Matching is automated; settlement is not unattended because the existing investment flow requires the investor to sign a Stellar transaction.

## Strategy Criteria

Strategies can filter on:

- Minimum expected ROI percentage
- Commodity whitelist
- Region text contained in the deal's farm location
- Maximum deal duration
- Maximum risk score
- Per-run allocation, per-strategy daily cap, and maximum per-deal position

Templates are available from `GET /v1/auto-invest/plans/templates`. Create a strategy with `POST /v1/auto-invest/plans`; list or update owned strategies through the corresponding collection and item endpoints. Only approved investors can create a strategy.

The scheduler evaluates due active strategies every 30 minutes. It scans up to 20 newest open deals per strategy and applies the criteria and risk score. When a match is found, it sends a notification that identifies the deal and proposed amount. The plan records its run time and advances its schedule.

## Execution Boundary

A deal match does not create or fund an investment. The investment API creates a pending investment and an unsigned Stellar transaction; the investor's wallet must sign that transaction before the queue consumer submits it. The auto-invest scheduler does not possess delegated signing authority. It therefore does not enqueue a synthetic investment ID or an empty signed XDR, and match notifications explicitly say that no funds have moved.

True unattended execution requires an explicit, opt-in delegated authorization design, key custody and revocation rules, transaction limits, and appropriate compliance review. Until that exists, strategies are deal discovery and alerting tools, not autonomous order execution.

## Backtesting and Performance

Run an owner-authorized backtest with:

```text
GET /v1/auto-invest/plans/{id}/backtest?from={ISO-8601}&to={ISO-8601}
```

The endpoint scans up to 2,000 historical deal records in the requested creation-date interval, applies the current strategy criteria and stored risk scores, and reports the number scanned, number matched, and average expected ROI for matches with ROI data. A `capped` flag indicates when the scan reached its limit.

Expected ROI is the deal's published estimate, not a realized return. The platform does not currently have an investment-level historical return series suitable for reporting realized win rate or maximum drawdown; those values are returned as unavailable. Backtests do not model transaction costs, liquidity, funding timing, partial fills, or a portfolio equity curve and must not be interpreted as forecasts or guarantees.

## Versions and Sharing

Updating an owned strategy increments its version and stores a snapshot of the prior criteria. `GET /v1/auto-invest/plans/{id}/versions` returns the current snapshot and owner-only history. Active strategies may be shared by setting `isPublic` to `true`; `GET /v1/auto-invest/plans/community` returns a sanitized criteria view and omits investor IDs, wallets, and allocation amounts. Set `isPublic` to `false` to remove a strategy from community listings.

Pre-built templates are starting points only. Applying a template does not create or activate a strategy until the investor reviews and submits the form.

## Risk and Alerts

Maximum risk score, daily cap, and maximum per-deal position are strategy-level controls. Deal matches and skipped scans use the existing notification service. There is no automated stop-loss or portfolio diversification enforcement in this release: there is no trusted mark-to-market and executed-allocation ledger connected to the strategy runner. The position cap limits a proposed allocation to one deal but is not a portfolio exposure guarantee.

## Current Limitations

- Strategy execution stops at a match alert pending investor wallet signature.
- ROI backtests use published expected ROI, not realized historical cash flows.
- Realized win rate, maximum drawdown, stop-loss, and portfolio diversification are unavailable until executed positions and their return history are modeled.
- A 30% increase in investment volume is a product outcome target, not a result this implementation can claim. It requires production measurement and an approved unattended execution flow.