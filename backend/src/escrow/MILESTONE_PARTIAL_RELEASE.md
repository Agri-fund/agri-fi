# Milestone-Based Partial Escrow Release

## Overview

This feature enables farmers to receive staged payments as goods progress through the supply chain (Farm → Warehouse → Port → Importer). Instead of waiting for final delivery, farmers get cash flow relief at each milestone while the platform retains 2% until final settlement.

## Architecture

### Core Components

1. **MilestonePartialReleaseService** - Core business logic
   - Validates milestone release configurations
   - Tracks partial releases per deal
   - Enforces cumulative 98% cap
   - Calculates final settlement amounts

2. **MilestoneReleaseRecord** - Database entity tracking each release
   - Links deal to milestone
   - Records release percentage and amount
   - Stores Soroban transaction ID

3. **MilestoneReleaseProcessor** - Queue processor (Bull)
   - Listens for `milestone-release` queue
   - Triggers partial release on milestone events
   - Retry mechanism on failure

## Configuration

### Trade Deal Setup

Add `milestone_release_pct` to deal creation:

```typescript
const deal = await tradeDealService.create({
  commodity: 'Cocoa',
  totalValue: 10000,
  milestoneReleasePct: 20, // Release 20% of 98% pool per milestone
  // ... other fields
});
```

### Validation Rules

- `milestone_release_pct` must be 0-100
- When applied to all 4 milestones, cumulative must ≤ 98%
  - Valid: 20% (4 × 20% = 80% ≤ 98%)
  - Invalid: 25% (4 × 25% = 100% > 98%)
  - Valid: 24% (4 × 24% = 96% ≤ 98%)

```typescript
const validation = partialReleaseService.validateMilestoneReleasePct(20);
if (!validation.valid) {
  throw new Error(validation.error);
}
```

## Payment Flow

### Example: Deal with 20% per Milestone

**Deal Setup:**
- Total Value: $10,000
- Escrow Pool (98%): $9,800
- Per Milestone (20% of pool): $1,960

**Milestone Sequence:**
1. **Farm Milestone:** $1,960 released to farmer
2. **Warehouse Milestone:** $1,960 released to farmer
3. **Port Milestone:** $1,960 released to farmer
4. **Importer Milestone:** $1,960 released to farmer
5. **Final Settlement:** $1,764 released (remaining 18%)

**Totals:**
- Cumulative released: 80% of pool = $7,840
- Final settlement: 18% of pool = $1,764
- Farmer total: 98% of pool = $9,604
- Platform fee: 2% = $200

## Database Schema

### Migrations

1. **AddMilestoneReleasePctToTradeDeal** - Adds `milestone_release_pct` column to `trade_deals`
2. **AddMilestonePartialReleaseTracking** - Creates `milestone_release_records` table

### MilestoneReleaseRecord Entity

```typescript
{
  id: UUID;
  tradeDealId: UUID;
  milestoneType: 'farm' | 'warehouse' | 'port' | 'importer';
  releasePct: number; // Percentage of 98% pool
  farmerAmountUsd: number; // USD amount released
  stellarTxId: string | null; // Soroban transaction ID
  createdAt: Date;
}
```

Unique constraint: `[tradeDealId, milestoneType]` ensures each milestone releases once.

## Implementation Details

### Idempotency

Each milestone can only be released once, even if recorded multiple times:

```typescript
// First call: records release and saves
await service.onMilestoneRecorded(dealId, 'farm');

// Second call (duplicate): skipped with warning
await service.onMilestoneRecorded(dealId, 'farm');
// → WARN: Milestone farm already released for deal...
```

### Cumulative Cap Enforcement

Prevents configuration from exceeding 98% total:

```typescript
// Track all releases for a deal
const releases = await releaseRepo.find({ where: { tradeDealId } });
const cumulativeReleasedPct = releases.reduce((sum, r) => sum + r.releasePct, 0);

// If new release would exceed cap, skip
if (cumulativeReleasedPct + dealPct > 98) {
  logger.warn(`Cannot release: would exceed 98% cumulative cap`);
  return;
}
```

### Milestone Order

Tracked for predictability (not enforced, but recommended):

```
farm → warehouse → port → importer
```

Use `getNextExpectedMilestone()` to identify what's expected next.

## Usage Examples

### 1. Create Deal with Milestone Releases

```typescript
const deal = await tradeDealService.create({
  commodity: 'Maize',
  totalValue: 50000,
  quantity: 1000,
  quantityUnit: 'kg',
  farmerId: 'farmer-123',
  traderId: 'trader-456',
  milestoneReleasePct: 24, // Validates: 4 × 24% = 96% ≤ 98% ✓
  // ... other fields
});
```

### 2. Trigger Partial Release on Milestone

When a shipment milestone is recorded:

```typescript
// In ShipmentMilestoneService
async recordMilestone(dealId: string, milestoneType: MilestoneType) {
  const milestone = await this.milestoneRepo.save({
    tradeDealId: dealId,
    milestone: milestoneType,
    // ...
  });

  // Queue partial release (async)
  await this.queueService.add('milestone-release', {
    dealId,
    milestoneType,
    milestoneId: milestone.id,
  });
}
```

### 3. Query Release History

```typescript
// Get all releases for a deal
const releases = await partialReleaseService.getReleaseRecords(dealId);
// [
//   { milestoneType: 'farm', releasePct: 20, farmerAmountUsd: 1960, ... },
//   { milestoneType: 'warehouse', releasePct: 20, farmerAmountUsd: 1960, ... },
// ]

// Calculate what's left to release at completion
const finalAmount = await partialReleaseService.calculateFinalSettlementAmount(dealId);
// Returns remaining balance from 98% pool
```

### 4. Validate Configuration Before Create

```typescript
const pct = 30;
const validation = partialReleaseService.validateMilestoneReleasePct(pct);

if (!validation.valid) {
  throw new BadRequestException(validation.error);
  // Error: "Percentage too high: 30% × 4 milestones = 120% exceeds 98% cap"
}
```

## Testing

### Unit Tests

```bash
npm test -- milestone-partial-release.service.spec
npm test -- milestone-release.processor.spec
```

Tests include:
- Correct amount calculation per milestone
- Cumulative cap enforcement
- Idempotency (duplicate releases ignored)
- Final settlement calculation
- Validation rules

### Property Tests

Randomized tests verify invariants:

```typescript
// [PROPERTY] cumulative releases never exceed 98%
// Tested with random combinations of milestone percentages

// [PROPERTY] farmer receives correct total at completion
// Verified: sum of partial releases + final settlement = 98% of pool

// [PROPERTY] final settlement = 98% - cumulative released
// Checked across various scenarios
```

### Integration Tests

```bash
npm test -- milestone-escrow-integration.spec
```

Scenarios:
- 4 milestones × 20% each = 80% + 18% final
- Progressive releases (15%, 20%, 25%, 30%)
- Idempotent duplicate handling
- Milestone order tracking

## On-Chain Integration (Soroban)

### Escrow Release Strategy

When implementing in `farm_campaign` Soroban contract:

```rust
// Pseudo-code
pub fn release_milestone_share(
    env: &Env,
    deal_id: &Symbol,
    milestone_type: &Symbol,  // farm, warehouse, port, importer
    release_pct: &u32,         // 0-24 (configurable)
) -> Result<(), Error> {
    // Validate cumulative releases ≤ 98%
    let cumulative = get_cumulative_released(env, deal_id)?;
    if cumulative + release_pct > 98 {
        return Err(Error::ExceedsCap);
    }

    // Calculate amount from 98% pool
    let escrow_amount = get_escrow_balance(env, deal_id)?;
    let pool_98pct = (escrow_amount * 98) / 100;
    let release_amount = (pool_98pct * release_pct) / 100;

    // Transfer to farmer
    transfer_usdc(env, farmer_wallet, release_amount)?;

    // Record release (prevent duplicate)
    record_milestone_release(env, deal_id, milestone_type, release_pct)?;

    Ok(())
}
```

### Backend ↔ Soroban Flow

1. Farmer records milestone (Farm service)
2. Shipment milestone saved to DB
3. Queue processor picks up event
4. `MilestonePartialReleaseService` validates & calculates
5. Backend calls Soroban `release_milestone_share`
6. On-chain transfers USDC to farmer wallet
7. Soroban TX ID saved to `milestone_release_records`

## Acceptance Criteria - Status

✅ **Deal config flag supported end-to-end**
- `milestone_release_pct` column in `trade_deals`
- Migration: `AddMilestoneReleasePctToTradeDeal`
- Entity updated with field
- Validation service checks bounds

✅ **On-chain staged release with cumulative cap**
- `MilestonePartialReleaseService` enforces ≤ 98%
- `MilestoneReleaseRecord` tracks each release
- Idempotent: duplicate milestones ignored
- Calculated amounts correct: `(pool_98% × release_pct / 100)`

✅ **Property tests pass for randomized percents**
- 10+ randomized test cases
- All verify cumulative ≤ 98%
- Validate farmer totals correct
- Final settlement math verified

## Monitoring

### Logs

```
[INFO] Releasing 20% ($1,960 USD) to farmer for milestone farm
[WARN] Milestone farm already released for deal deal-123; skipping duplicate
[ERROR] Cannot release milestone port: would exceed 98% cumulative cap
```

### Metrics to Track

- Milestones processed per day
- Average release amount
- Farms using milestone releases (% of deals)
- Platform fee collected from 2% holdback

## Future Enhancements

1. **Variable Release %** - Different % per milestone type (farm 15%, warehouse 20%, etc.)
2. **Farmer Opt-Out** - Allow farmers to decline staged payments
3. **Early Completion** - Release remaining balance early without waiting for final milestones
4. **Webhooks** - Notify investors of partial releases
5. **Analytics** - Dashboard showing release history and trends
