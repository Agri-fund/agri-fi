# API Changes - Configurable Fee Structure

## Summary

Added comprehensive fee configuration API endpoints and updated investment endpoints to include fee breakdown information.

## New Endpoints

### Admin Fee Configuration Management

All endpoints require `admin` role (via `AdminGuard`).

#### 1. Create Fee Configuration
```
POST /admin/fee-configurations
Content-Type: application/json
Authorization: Bearer <token>

Request:
{
  "dealType": "Cocoa",
  "investorTier": "retail",
  "feeType": "platform_origination",
  "ratePercent": 2.5,
  "description": "Cocoa deals origination fee",
  "effectiveFrom": "2024-06-01T00:00:00Z",
  "effectiveTo": null
}

Response: 201 Created
{
  "id": "fee-config-uuid",
  "dealType": "Cocoa",
  "investorTier": "retail",
  "feeType": "platform_origination",
  "ratePercent": 2.5,
  "description": "Cocoa deals origination fee",
  "effectiveFrom": "2024-06-01T00:00:00Z",
  "effectiveTo": null,
  "createdAt": "2024-06-01T12:00:00Z",
  "updatedAt": "2024-06-01T12:00:00Z"
}

Errors:
- 400: Invalid input (rate not 0-100, invalid dates, etc.)
- 409: Configuration already exists for this combination
```

#### 2. List Fee Configurations
```
GET /admin/fee-configurations?skip=0&take=10&dealType=Cocoa&investorTier=retail&feeType=platform_origination&active=true

Query Parameters:
- skip: number (default 0) - pagination offset
- take: number (default 10) - page size
- dealType: string (optional) - filter by commodity
- investorTier: "retail" | "vip" | "institutional" (optional)
- feeType: "platform_origination" | "platform_success" | "investor_entry" | "early_exit" (optional)
- active: boolean (optional) - filter by active/inactive

Response: 200 OK
{
  "data": [
    {
      "id": "fee-config-uuid",
      "dealType": "Cocoa",
      "investorTier": "retail",
      "feeType": "platform_origination",
      "ratePercent": 2.0,
      "description": "Platform origination fee",
      "effectiveFrom": "2024-01-01T00:00:00Z",
      "effectiveTo": null,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z"
    }
  ],
  "total": 120,
  "skip": 0,
  "take": 10
}
```

#### 3. Get All Deal Types
```
GET /admin/fee-configurations/deal-types

Response: 200 OK
[
  "Cocoa",
  "Coffee",
  "Maize",
  "Rice",
  "Soybeans",
  "Wheat"
]
```

#### 4. Get Fee Configuration Matrix
```
GET /admin/fee-configurations/matrix/Cocoa

Response: 200 OK
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

Errors:
- 404: No configurations found for deal type
```

#### 5. Get Fee Configuration by ID
```
GET /admin/fee-configurations/{id}

Response: 200 OK
{
  "id": "fee-config-uuid",
  "dealType": "Cocoa",
  "investorTier": "retail",
  "feeType": "platform_origination",
  "ratePercent": 2.0,
  "description": "Platform origination fee",
  "effectiveFrom": "2024-01-01T00:00:00Z",
  "effectiveTo": null,
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}

Errors:
- 404: Fee configuration not found
```

#### 6. Update Fee Configuration
```
PUT /admin/fee-configurations/{id}
Content-Type: application/json
Authorization: Bearer <token>

Request (all fields optional):
{
  "ratePercent": 3.0,
  "description": "Updated description",
  "effectiveTo": "2024-12-31T23:59:59Z"
}

Response: 200 OK
{
  "id": "fee-config-uuid",
  "dealType": "Cocoa",
  "investorTier": "retail",
  "feeType": "platform_origination",
  "ratePercent": 3.0,
  "description": "Updated description",
  "effectiveFrom": "2024-01-01T00:00:00Z",
  "effectiveTo": "2024-12-31T23:59:59Z",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-06-15T10:30:00Z"
}

Errors:
- 400: Invalid update (rate out of range, effectiveTo before effectiveFrom)
- 404: Fee configuration not found
```

#### 7. Delete Fee Configuration
```
DELETE /admin/fee-configurations/{id}
Authorization: Bearer <token>

Response: 204 No Content

Errors:
- 400: Cannot delete active configuration (must expire first with PUT)
- 404: Fee configuration not found
```

## Updated Endpoints

### Investment Creation
```
POST /investments
Content-Type: application/json
Authorization: Bearer <token>

Request: (unchanged)
{
  "tradeDealId": "deal-uuid",
  "tokenAmount": 100,
  "amountUsd": 10000.00,
  "complianceData": {
    "originator": {...},
    "beneficiary": {...}
  }
}

Response: 200 OK
{
  "investment": {
    "id": "inv-uuid",
    "tradeDealId": "deal-uuid",
    "investorId": "user-uuid",
    "tokenAmount": 100,
    "amountUsd": 10000.00,
    "feeBreakdown": {                            ← NEW
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
      "breakdown": [...]
    },
    "status": "pending",
    "stellarTxId": null,
    "createdAt": "2024-06-15T10:30:00Z"
  },
  "unsignedXdr": "AAAAAgAAAAD...",                  ← XDR now includes fee memo
  "feeBreakdown": {...}                            ← NEW (same as above)
}
```

## Response DTOs

### FeeLineItemDto
```typescript
{
  type: "platform_origination" | "platform_success" | "investor_entry" | "early_exit";
  description: string;
  ratePercent: number;
  amount: number;  // in USD
  effectiveFrom: Date;
}
```

### FeeBreakdownDto
```typescript
{
  grossAmount: number;
  platformOriginationFee: FeeLineItemDto | null;
  platformSuccessFee: FeeLineItemDto | null;
  investorEntryFee: FeeLineItemDto | null;
  earlyExitFee: FeeLineItemDto | null;
  totalFees: number;
  netInvestmentAmount: number;
  breakdown: FeeLineItemDto[];
}
```

### InvestmentResponseDto
```typescript
{
  id: string;
  tradeDealId: string;
  investorId: string;
  tokenAmount: number;
  amountUsd: number;
  feeBreakdown: FeeBreakdownDto;  ← NEW
  status: "pending" | "confirmed" | "failed" | "refunded";
  stellarTxId: string | null;
  createdAt: Date;
}
```

### CreateInvestmentResponseDto
```typescript
extends InvestmentResponseDto {
  unsignedXdr: string;
}
```

## Error Responses

All endpoints follow standard error format:

```json
{
  "statusCode": 400,
  "message": "Error description",
  "error": "Bad Request"
}
```

Common errors:

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Bad Request | Invalid input (rate, dates, compliance data) |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Insufficient permissions (non-admin for fee endpoints) |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Duplicate fee configuration |
| 422 | Unprocessable Entity | Business logic violation (deal not open, insufficient tokens, etc.) |

## Authentication

All new endpoints require:
- Valid JWT token in `Authorization: Bearer <token>` header
- `admin` role (for fee configuration endpoints)

Investor tier is determined from user role:
- `admin`, `company_admin` → `institutional`
- All others → `retail` (can be upgraded to VIP via future user profile settings)

## Backward Compatibility

- Existing investments continue to work without changes
- Fee breakdown is calculated on-the-fly during investment creation
- No breaking changes to existing endpoints
- All new fields are additive (existing clients can ignore feeBreakdown)

## Transaction Memo Format

Stellar transaction memo now includes fee information:

```
invest:<ASSET_CODE>:<TOKEN_AMOUNT>:<FEE_HASH>
```

Example: `invest:COCOA001:100:abc123def456`

This allows verification of fees at settlement time.

## Database Migrations

Migration `1830000000000-CreateFeeConfigurations`:
- Creates `fee_configurations` table
- Creates `fee_type_enum` and `investor_tier_enum` types
- Seeds default fee configurations (2% origination, 0.5% success, tiered entry 1%/0.5%/0%, 2% early exit)
- Creates performance indexes

## Generate Updated Documentation

To regenerate the OpenAPI schema after deploying these changes:

```bash
npm run build
node generate-openapi.js
```

This will update `openapi.json` with all fee configuration endpoints and updated investment response schemas.

## Testing

### Unit Tests
- FeeCalculatorService: 30+ test cases
- Fee application and rounding
- Tier-based fee calculations
- Effective date transitions

### Integration Tests
- Admin CRUD operations
- Fee configuration matrix generation
- Investment creation with fee breakdown
- Atomic transaction encoding

### E2E Tests (Playwright)
- Complete investment flow with fee display
- Admin dashboard fee management
- Fee verification in transaction confirmation
