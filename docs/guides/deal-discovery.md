# Deal discovery guide

How investors find deals on the marketplace (`/marketplace`).

## Filters

| Criterion | Query parameter | Notes |
|---|---|---|
| Crop type | `commodity` | Comma separated, e.g. `cocoa,coffee` |
| Region | `region`, `country` | Case-insensitive contains match |
| Funding status | `status` | `open` (under 50% funded), `almost funded`, `fully funded` |
| ROI range | `minRoi`, `maxRoi` | Percent, `minRoi` must not exceed `maxRoi` |
| Minimum investment | `minAmount`, `maxAmount` | Compared to the deal's minimum investment lot |
| Deal duration | `duration` | `<3 months`, `3-6 months`, `6-12 months`, `>12 months` |

Free text search uses `q`. Invalid combinations (reversed ranges, negative numbers, unknown values) return `400` with an `errors` list.

## Sorting

`sortBy` accepts `newest` (default), `highest_roi`, `closing_soon`, `most_funded`, `largest_amount` and `highest_esg`. Any other value returns `400`.

## Saved searches and alerts

Requires login. Routes are under `/v1/deal-discovery`.

| Method | Path | Description |
|---|---|---|
| GET | `/saved-searches` | List your saved searches |
| POST | `/saved-searches` | `{ name, filters, notifyInApp?, notifyEmail? }`. Up to 20 per user |
| DELETE | `/saved-searches/:id` | Remove one |

A background job runs every 5 minutes. When an open deal matches a saved search and you have not been told about it yet, you get an in-app notification and, if `notifyEmail` is set, an email. Deals that already matched when you saved the search do not trigger alerts. Alert matching covers the 500 newest open deals and approximates the full-text query by requiring every word of `q` to appear in the title or descriptions.

## Search history

| Method | Path | Description |
|---|---|---|
| GET | `/history` | Your 20 most recent searches |
| POST | `/history` | `{ filters, resultCount? }`. Repeating the latest search does not add a duplicate |
| DELETE | `/history` | Clear history |

Re-running a search means sending its stored `filters` to `GET /trade-deals`.

## Comparing deals

`GET /v1/deal-discovery/compare?ids=<id>,<id>[,<id>]` returns value, funding progress, minimum investment, ROI, duration, risk, ESG score and delivery date for 2 or 3 public deals, in the order requested.

## Performance

Filter and sort columns on `trade_deals` have indexes (migration `CreateDealDiscovery`): `(status, expected_roi)`, `(status, min_investment_lot)`, `(status, created_at)`, `(status, delivery_date)` and `LOWER(commodity)`.
