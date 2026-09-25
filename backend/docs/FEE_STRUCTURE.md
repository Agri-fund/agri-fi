# Configurable Fee Structure

## Overview

AgriFi implements a configurable, multi-tier fee structure supporting:

- **Platform origination fees** (% of deal target, charged to farmer)
- **Platform success fees** (% of returns, charged to farmer at payout)
- **Investor entry fees** (% of investment, tiered by investor type)
- **Early exit fees** (flat % penalty for exiting before maturity)

## Fee Types

### Platform Origination Fee
- **Who pays**: Farmer
- **When charged**: When investment is confirmed on-chain
- **Amount**: Percentage of deal target
- **Default**: 2% for all commodity types
- **Purpose**: Cover platform origination costs (underwriting, documentation, etc.)

### Platform Success Fee
- **Who pays**: Farmer
- **When charged**: When deal completes and payout is distributed
- **Amount**: Percentage of returns/profits
- **Default**: 0.5% for all commodity types
- **Purpose**: Align platform incentives with farmer success

### Investor Entry Fee
- **Who pays**: Investor
- **When charged**: When investment is confirmed on-chain
- **Amount**: Percentage of investment (tiered by investor tier)
- **Tiers**:
  - Retail: 1.0% (default investor tier)
  - VIP: 0.5% (higher-volume or verified investors)
  - Institutional: 0% (company admins, large entities)
- **Purpose**: Offset platform transaction costs for small retail investors

### Early Exit Fee
- **Who pays**: Investor
- **When charged**: If investor exits investment before deal maturity
- **Amount**: Flat percentage of remaining investment value
- **Default**: 2% for all tiers and commodities
- **Purpose**: Discourage early exits that disrupt deal funding

## Investor Tiers

Investor tiers are determined based on user role and can be extended based on account attributes:

| Tier | Role | Entry Fee | Use Case |
|------|------|-----------|----------|
| Retail | investor | 1.0% | Individual investors |
| VIP | - | 0.5% | High-volume or verified investors (configurable in user profile) |
| Institutional | company_admin, admin | 0% | Institutional investors, company accounts |

## Fee Calculation Flow

### During Investment Creation

1. **Investor initiates investment** with amount and deal selection
2. **System fetches investor tier** based on user role
3. **System calculates fee breakdown**:
   - Loads active fee configurations for deal type + investor tier
   - Calculates each fee type
   - Computes net investment (gross - entry fees)
4. **Fee breakdown returned to frontend** for approval
5. **Fee data encoded into Stellar transaction memo** for atomicity
6. **Transaction XDR returned to investor for signing**

### Upon Transaction Confirmation

1. **Investor signs and broadcasts transaction**
2. **Fee data extracted from transaction memo** for verification
3. **Investment marked as CONFIRMED** in database
4. **Fee audit log created** for each fee type
5. **Fee distribution scheduled** via queue service

### At Deal Completion (Payout)

1. **Platform success fee calculated** from actual returns
2. **Farmer payout reduced** by platform origination + success fees
3. **Investor entry and early exit fees** already collected (or waived for maturity)

## Atomic Fee Application

Fees are applied atomically through Stellar transactions to ensure:

- **Consistency**: Fees are either fully applied or transaction fails
- **Immutability**: Fee amounts encoded in transaction memo (tamper-proof)
- **Auditability**: Complete fee history in Stellar ledger + database

### Fee Encoding in Transaction

Transaction memo format: `invest:<ASSET_CODE>:<TOKEN_AMOUNT>:<FEE_HASH>`

Example: `invest:COCOA001:100:abc123def456`

The fee hash allows the backend to verify that fees calculated at transaction time match the actual investment when confirmed.

## Admin Configuration

### API Endpoints

#### List Fee Configurations
```
GET /admin/fee-configurations?dealType=Cocoa&investorTier=retail&active=true
```

#### Create New Fee Configuration
```
POST /admin/fee-configurations
{
  "dealType": "Coffee",
  "investorTier": "retail",
  "feeType": "platform_origination",
  "ratePercent": 2.5,
  "description": "Coffee deals origination fee",
  "effectiveFrom": "2024-06-01T00:00:00Z",
  "effectiveTo": null
}
```

#### Get Fee Matrix
```
GET /admin/fee-configurations/matrix/Cocoa
```

Returns all fees for a commodity across all tiers:
```json
{
  "retail": {
    "platform_origination": 2.0,
    "platform_success": 0.5,
    "investor_entry": 1.0,
    "early_exit": 2.0
  },
  "vip": {
    "platform_origination": 2.0,
    "platform_success": 0.5,
    "investor_entry": 0.5,
    "early_exit": 2.0
  },
  "institutional": {
    "platform_origination": 2.0,
    "platform_success": 0.5,
    "investor_entry": 0.0,
    "early_exit": 2.0
  }
}
```

#### Update Fee Configuration
```
PUT /admin/fee-configurations/{id}
{
  "ratePercent": 3.0,
  "effectiveTo": "2024-12-31T23:59:59Z"
}
```

Note: Cannot update `dealType`, `investorTier`, or `feeType` once created. Create new configuration with new effective date instead.

#### Expire Fee Configuration
To retire a fee configuration without deleting it:
```
PUT /admin/fee-configurations/{id}
{
  "effectiveTo": "2024-06-01T00:00:00Z"
}
```

### UI Admin Panel

Located at `/admin/fee-configurations`

Features:
- **Filter by**: Deal type, Investor tier, Fee type, Active/Inactive status
- **Paginated table** showing all configurations
- **Fee matrix view** for quick comparison across tiers
- **Create/Edit forms** with date pickers and validation
- **Status indicators** (Active/Inactive based on effective dates)

## Fee Breakdown in API Response

Investment creation response includes complete fee breakdown:

```json
{
  "id": "inv-123",
  "tradeDealId": "deal-456",
  "investorId": "user-789",
  "amountUsd": 10000.00,
  "feeBreakdown": {
    "grossAmount": 10000.00,
    "platformOriginationFee": {
      "type": "platform_origination",
      "description": "Platform origination fee",
      "ratePercent": 2.0,
      "amount": 200.00,
      "effectiveFrom": "2024-01-01T00:00:00Z"
    },
    "platformSuccessFee": {
      "type": "platform_success",
      "description": "Platform success fee",
      "ratePercent": 0.5,
      "amount": 50.00,
      "effectiveFrom": "2024-01-01T00:00:00Z"
    },
    "investorEntryFee": {
      "type": "investor_entry",
      "description": "Investor entry fee (retail)",
      "ratePercent": 1.0,
      "amount": 100.00,
      "effectiveFrom": "2024-01-01T00:00:00Z"
    },
    "earlyExitFee": null,
    "totalFees": 350.00,
    "netInvestmentAmount": 9900.00,
    "breakdown": [
      { /* all line items */ }
    ]
  },
  "status": "pending",
  "unsignedXdr": "AAAAAgAAAAD..."
}
```

## Migration from Hard-Coded Fees

The system migrates from hard-coded 2% platform fee to this configurable structure:

### Before
```typescript
const PLATFORM_FEE_PERCENT = 2; // Hard-coded
const fee = amountUsd * (PLATFORM_FEE_PERCENT / 100);
```

### After
```typescript
// Load configurations by deal type + investor tier
const feeConfigs = await feeConfigRepository.find({
  dealType: 'Cocoa',
  investorTier: 'retail',
  effectiveFrom: { _type: 'lte', value: now },
  effectiveTo: { _type: 'gt', value: now }
});

// Calculate all fees atomically
const feeBreakdown = await feeCalculator.calculateFeeBreakdown({
  dealType: 'Cocoa',
  investorTier: 'retail',
  grossAmount: 10000
});
```

## Testing

### Unit Tests
- FeeCalculatorService: 30+ tests covering all scenarios
- Retail/VIP/Institutional tier calculations
- Edge cases (zero amount, large amounts, rounding)
- Effective date transitions

### Integration Tests
- Fee calculation during investment creation
- Atomic transaction encoding
- Admin CRUD operations
- Fee matrix generation

### E2E Tests
- Complete investment flow with fee breakdown
- Admin fee configuration management
- Fee application at payout

## Database Schema

```sql
CREATE TABLE fee_configurations (
  id UUID PRIMARY KEY,
  deal_type VARCHAR(100) NOT NULL,
  investor_tier ENUM('retail', 'vip', 'institutional'),
  fee_type ENUM('platform_origination', 'platform_success', 'investor_entry', 'early_exit'),
  rate_percent NUMERIC(5,3) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  description TEXT,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (deal_type, investor_tier, fee_type, effective_from)
);

CREATE INDEX idx_fee_config_deal_type ON fee_configurations(deal_type);
CREATE INDEX idx_fee_config_investor_tier ON fee_configurations(investor_tier);
CREATE INDEX idx_fee_config_fee_type ON fee_configurations(fee_type);
CREATE INDEX idx_fee_config_effective ON fee_configurations(effective_from, effective_to);
```

## Backward Compatibility

- Existing investments maintain 2% platform fee via seed data in migration
- New configurations can be added without affecting existing deals
- API versioning ensures frontend compatibility during transitions
