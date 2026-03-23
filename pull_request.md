# feat: marketplace pages and POST /investments endpoint

## Summary

Implements requirements 7.4, 7.5 (public marketplace frontend) and 4.1, 4.4 (investor funding endpoint).

---

## Changes

### Frontend

**`frontend/src/lib/api.ts`**
- Typed interfaces: `TradeDeal`, `Document`, `Milestone`
- `getOpenDeals()` — fetches all open deals from `GET /trade-deals`
- `getDealById(id)` — fetches a single deal, returns `null` on 404

**`frontend/src/components/FundingProgressBar.tsx`**
- Visual progress bar showing amount raised, percentage, and remaining funding
- Uses `role="progressbar"` with `aria-valuenow/min/max` for accessibility

**`frontend/src/components/StatusBadge.tsx`**
- Colour-coded pill badge: open=green, funded=blue, delivered=orange, completed=grey, failed=red

**`frontend/src/app/marketplace/page.tsx`**
- Public page — no auth required
- Fetches open deals only (client-side filter as belt-and-suspenders)
- Responsive card grid (1→2→3 columns) with commodity, quantity, total value, delivery date, funding progress bar
- Empty state when no open deals exist
- Each card links to `/marketplace/[id]`

**`frontend/src/app/marketplace/[id]/page.tsx`**
- Public page — no auth required (read-only)
- Displays commodity, quantity, quantity unit, total value, delivery date, token symbol, status badge
- Funding progress bar (total_invested / total_value)
- Document list: type, IPFS link, upload date
- Milestone timeline: ordered farm → warehouse → port → importer with timestamp and notes
- "Fund this Deal" button rendered only when `status === 'open'` (links to `/invest/[id]`)
- Calls `notFound()` for missing deals — renders Next.js 404 page

---

### Backend

**`backend/src/investments/dto/create-investment.dto.ts`**
- `trade_deal_id`: UUID (required)
- `token_amount`: positive integer (required)

**`backend/src/investments/entities/investment.entity.ts`**
- Re-exports `Investment` from canonical location (`users/entities`) for local module imports

**`backend/src/investments/investments.service.ts`**
- Role check: rejects non-investors with 403
- Runs inside a `pessimistic_write` DB transaction to prevent race conditions on concurrent funding
- Locks the deal row, checks `status === 'open'` (422 otherwise)
- Sums `confirmed` investment token amounts to compute availability
- Rejects with 400 if `token_amount` exceeds available tokens
- Stores `amount_usd = token_amount * 100`
- Creates investment with `status = 'pending'`

**`backend/src/investments/investments.controller.ts`**
- `POST /investments` — guarded by `AuthGuard('jwt')` + `KycGuard`
- Returns 201 with the created investment object

**`backend/src/investments/investments.module.ts`**
- Registers `Investment` and `TradeDeal` repositories
- Exports `InvestmentsService` for use by other modules

---

## Requirements covered

| Req | Description | Status |
|-----|-------------|--------|
| 7.5 | Marketplace shows only `status = 'open'` deals | done |
| 7.4 | Deal detail shows commodity, quantity, value, funding progress, documents, milestones | done |
| 4.1 | `amount_usd` calculated as `token_amount * 100` | done |
| 4.4 | Reject if `token_amount` exceeds available tokens | done |

---

## Acceptance criteria

- [x] `GET /trade-deals` fetched without auth on marketplace page
- [x] Card grid with commodity, quantity, total value, funding progress bar, remaining funding, delivery date
- [x] Each card links to deal detail page
- [x] Empty state when no open deals
- [x] Deal detail shows all required fields + status badge
- [x] Document list with type, IPFS URL, upload date
- [x] Milestone timeline ordered with timestamp and notes
- [x] "Fund this Deal" button visible only when `status = 'open'`
- [x] 404 page if deal does not exist
- [x] `POST /investments` requires JWT + `role = 'investor'` (403 otherwise)
- [x] `POST /investments` requires `kyc_status = 'verified'` (403 `KYC_REQUIRED` otherwise)
- [x] Request body validated: `trade_deal_id` (UUID) and `token_amount` (positive integer)
- [x] 422 if deal status is not `open`
- [x] 400 if `token_amount` exceeds available tokens
- [x] Available token check is atomic (pessimistic row lock in DB transaction)
- [x] Investment created with `status = 'pending'`, returns 201
- [x] No Stellar transaction submitted

---

## How to test

```bash
# Marketplace
open http://localhost:3000/marketplace

# Deal detail
open http://localhost:3000/marketplace/<deal-id>

# Fund a deal (investor JWT required)
curl -X POST http://localhost:3001/investments \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"trade_deal_id": "<uuid>", "token_amount": 5}'
```
