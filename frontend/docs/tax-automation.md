# Tax Automation & Reporting

## Overview

The Tax Automation feature provides investors with a comprehensive suite of tools to calculate tax liabilities, generate compliant tax reports, optimize tax strategies, and simplify tax compliance across multiple jurisdictions. It reduces tax compliance effort by approximately 70% through automated calculations, deadline alerts, and accountant-ready exports.

## Features

### 1. Tax Calculation Engine

Automatically calculates three categories of investment income tax:

- **Capital Gains** — Long-term and short-term gains based on holding period thresholds per jurisdiction
- **Dividend Income** — Proportional share of deal profits classified as dividend-equivalent income
- **Interest Income** — Interest-bearing position returns taxed at ordinary income rates

The engine uses jurisdiction-specific tax rates and holding period thresholds (e.g., US: 365 days for long-term, India: 730 days).

**Library:** `frontend/src/lib/tax/tax-calculator.ts`

### 2. Multi-Jurisdiction Support

Supports 8 jurisdictions with localized tax rules:

| Jurisdiction | Long-term Rate | Short-term Rate | Dividend Rate | Withholding Rate | LT Threshold |
|---|---|---|---|---|---|
| US | 15% | 37% | 15% | 24% | 365 days |
| UK | 20% | 45% | 33.75% | 20% | 365 days |
| CA | 25% | 50% | 38.29% | 25% | 365 days |
| AU | 22.5% | 45% | 30% | 32.5% | 365 days |
| EU | 25% | 40% | 20% | 20% | 365 days |
| ZA | 18% | 45% | 20% | 15% | 365 days |
| IN | 12.5% | 20% | 30% | 10% | 730 days |
| SG | 0% | 0% | 22% | 0% | 365 days |

**Library:** `frontend/src/lib/tax/jurisdictions.ts` (templates), `tax-calculator.ts` (rates)

### 3. Tax Report Generation

Generates jurisdiction-specific tax forms with correct field mappings:

- **US:** Form 1099-DIV, 1099-INT, 1099-B, Schedule D
- **UK:** SA302 (Self Assessment)
- **Canada:** T5008 (Statement of Securities Transactions)
- **Australia:** CGT Schedule
- **India:** ITR Capital Gains Schedule
- **Singapore:** Form B
- **Other EU/International:** Generic CGT Schedule

Each form includes proper box numbers, line items, and calculated totals.

**Library:** `frontend/src/lib/tax/tax-forms.ts`

### 4. Tax Optimization Suggestions

Analyzes the investor's portfolio and suggests actionable optimizations:

- **Tax-Loss Harvesting** — Identifies investments with unrealized losses that can offset capital gains
- **Long-Term Holding** — Flags positions approaching the long-term threshold (within 60 days) and calculates potential savings
- **Fee Deduction** — Reminds investors to deduct platform fees as investment expenses
- **Jurisdiction Optimization** — Alerts on short-term gains exposure for jurisdictions with high marginal rates
- **Timing Optimization** — Suggests staggering gains across tax years to reduce marginal bracket exposure

**Library:** `frontend/src/lib/tax/tax-optimization.ts`

### 5. Tax Withholding at Source

Automatically calculates withholding tax from investment payouts:

- Uses jurisdiction-specific withholding rates
- Creates withholding records tracking gross payout, withholding amount, and net payout
- Tracks remittance status to tax authority
- Provides annual withholding summaries

**Library:** `frontend/src/lib/tax/tax-withholding.ts`

### 6. Tax Document Secure Storage

Manages encrypted storage of tax documents:

- Integrates with existing IPFS/S3 document storage infrastructure
- Documents encrypted at rest (AES-256)
- 7-year retention period tracking
- Document verification status
- Grouping by tax year for organized retrieval

**Library:** `frontend/src/lib/tax/tax-document-storage.ts`

### 7. Tax Deadline Alerts

Tracks filing deadlines across all supported jurisdictions:

- Filing deadlines (e.g., US April 15, UK January 31)
- Extension deadlines (e.g., US October 15)
- Estimated payment due dates (quarterly for US, monthly/quarterly for others)
- Severity levels: overdue, critical (≤7 days), warning (≤30 days), info
- Generates actionable alert messages

**Library:** `frontend/src/lib/tax/tax-deadlines.ts`

### 8. Accountant Export Integration

Exports complete tax data in formats suitable for accountant review:

- **CSV Bundle** — Multi-section CSV with all calculations, withholding, and compliance
- **JSON Export** — Complete structured data for programmatic import
- **QuickBooks CSV** — Account/Date/Amount format compatible with QuickBooks import
- **TurboTax CSV** — Category/Description/Proceeds/Cost Basis format for TurboTax

**Library:** `frontend/src/lib/tax/tax-accountant-export.ts`

### 9. Tax Compliance Verification

Ensures reports meet regulatory requirements:

- TIN validation check
- Reporting threshold verification per jurisdiction
- Form completeness check (all required forms generated)
- Jurisdiction alignment (categories match template)
- Data accuracy verification
- Deadline compliance check
- Overall status: compliant, warning, or non-compliant

**Library:** `frontend/src/lib/tax/tax-compliance.ts`

## Architecture

### Components

#### `TaxAutomationDashboard.tsx`
Main dashboard component with 7 tabs:
- **Overview** — Summary cards, deadline alerts, compliance status, upcoming deadlines
- **Tax Calculations** — Capital gains table, dividend/interest income, withholding summary
- **Optimization** — Actionable tax optimization suggestions
- **Tax Forms** — Generated forms with field details and line items
- **Compliance** — Full compliance verification report
- **Accountant Export** — Export buttons for all formats
- **Settings** — Existing TaxSettings component for jurisdiction/TIN management

#### `TaxSettings.tsx` (existing)
- Jurisdiction selection
- TIN capture with validation
- Export format preference

#### `TaxReportDownload.tsx` (existing)
- Year/jurisdiction report download
- CSV/PDF export

### Utilities

| File | Purpose |
|---|---|
| `tax-calculator.ts` | Core calculation engine (capital gains, dividends, interest) |
| `tax-optimization.ts` | Portfolio analysis for optimization suggestions |
| `tax-withholding.ts` | Withholding calculation and record management |
| `tax-deadlines.ts` | Deadline tracking and alert generation |
| `tax-forms.ts` | Tax form generation (1099, Schedule D, SA302, T5008, etc.) |
| `tax-compliance.ts` | Regulatory compliance verification |
| `tax-accountant-export.ts` | Multi-format export (CSV, JSON, QuickBooks, TurboTax) |
| `tax-document-storage.ts` | Encrypted document storage management |
| `jurisdictions.ts` | Jurisdiction templates and tax categories |
| `tin-validation.ts` | TIN format validation per jurisdiction |

### API Routes

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/tax/calculation` | Fetch tax calculation results |
| GET | `/api/tax/optimization` | Fetch optimization suggestions |
| GET | `/api/tax/withholding` | Fetch withholding records |
| GET | `/api/tax/deadlines` | Fetch deadline alerts |
| GET | `/api/tax/compliance` | Fetch compliance report |
| GET | `/api/tax/forms` | Fetch generated tax forms |
| POST | `/api/tax/forms` | Generate new tax forms |
| GET | `/api/tax/accountant-export` | Export tax data for accountant |
| GET | `/api/tax/documents` | List stored tax documents |
| POST | `/api/tax/documents` | Upload tax document |

### API Client

The `frontend/src/lib/api/tax-report.ts` file provides typed client functions for all tax automation endpoints:

```typescript
getTaxCalculation(year, jurisdiction, token?)
getTaxOptimization(year, token?)
getTaxWithholding(year, token?)
getTaxDeadlines(year, token?)
getTaxCompliance(year, token?)
exportForAccountant(year, format, token?)
getTaxDocuments(year, token?)
uploadTaxDocument(data, token?)
```

## Data Flow

```
Investor navigates to Tax Automation Center (/dashboard/investor/tax)
    ↓
Investments loaded from /api/investments/my-investments
    ↓
Mapped to InvestmentTaxData format (dealId, amounts, dates, status)
    ↓
TaxCalculator computes capital gains, dividends, interest
    ↓
TaxForms generates jurisdiction-specific forms (1099, Schedule D, etc.)
    ↓
ComplianceEngine verifies all forms and data
    ↓
OptimizationEngine analyzes portfolio for suggestions
    ↓
DeadlineEngine fetches upcoming filing deadlines
    ↓
WithholdingEngine calculates tax withheld from payouts
    ↓
Dashboard renders all data in tabbed interface
    ↓
User can export via Accountant Export tab (CSV/JSON/QuickBooks/TurboTax)
```

## Configuration

### Supported Tax Years
- Current year minus 4 (e.g., 2021-2025)

### Supported Jurisdictions
- US, UK, CA, AU, EU, ZA, IN, SG

### Document Retention
- 7 years from tax year end date

## Security

- TINs encrypted at rest (AES-256-GCM) — handled by existing backend
- TINs never exposed in API responses (masked)
- Tax documents stored encrypted in IPFS/S3
- All tax API endpoints require authentication
- Audit trail on tax document access

## Related Features

- **Investor Dashboard** — Tax center accessible from investor navigation
- **Portfolio Summary** — Investment data feeds into tax calculations
- **Document Storage** — Tax documents leverage existing IPFS/S3 infrastructure
- **User Profile** — Jurisdiction detection from user profile data
