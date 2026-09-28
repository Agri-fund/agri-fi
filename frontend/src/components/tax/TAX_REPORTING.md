# Investor Tax Summary & Reporting

## Overview

The Tax Reporting feature enables investors to generate jurisdiction-specific tax reports with localized breakdowns of capital gains, dividend income, and fees. Reports can be downloaded in CSV or PDF format and include country-specific tax guidance.

## Features

### 1. Tax Settings Management
- **Jurisdiction Selection** - Choose tax reporting country (US, UK, CA, AU, EU, ZA, IN, SG)
- **TIN Capture** - Tax Identification Number per country:
  - US: Social Security Number (SSN) `XXX-XX-XXXX`
  - UK: National Insurance Number (NINO) `AB123456C`
  - Canada: Social Insurance Number (SIN) `XXX-XXX-XXX`
  - Australia: Tax File Number (TFN) `XXX XXX XXX`
  - India: PAN `XXXXXAXXXX`
  - Singapore: NRIC/FIN `XXXYYYYZZZZ`
- **Format Preference** - Choose default export format (CSV/PDF)

### 2. Localized Tax Reports
Per-jurisdiction tax categorization:
- **US**: Long-term/short-term capital gains, dividend income, deductible fees
- **UK**: Chargeable gains, savings income, investment costs
- **Canada**: Capital gains (50% inclusion), dividend income, expenses
- **Australia**: Capital gains (50% discount), ordinary income, expenses
- **EU**: Member-state specific (variable)
- **South Africa**: Long-term CGT (40% inclusion), DTC dividends
- **India**: LTCG/STCG (2-year holding), dividend income
- **Singapore**: Capital gains (exempt), dividend income, remittance rules

### 3. Export Formats
- **CSV** - Excel-compatible spreadsheet with transaction details
- **PDF** - Print-friendly formatted report with summary

### 4. Security & Privacy
- TINs encrypted at rest (AES-256-GCM)
- Encrypted database field, decrypted only for report generation
- TINs never exposed in API responses (masked like `***-**-6789`)
- PII protection aligns with GDPR/privacy regulations

## Architecture

### Components

#### `TaxSettings.tsx`
User settings for tax reporting:
- Jurisdiction selection
- TIN capture with format validation
- Export format preference
- Secure storage

**Props:** None (uses context or session)

#### `TaxReportDownload.tsx`
Report generation and download:
- Year and jurisdiction selection
- Summary preview before download
- CSV/PDF export
- Tax category breakdown

**Props:** None (uses API)

### Utilities

#### `jurisdictions.ts`
Tax templates with localized categories:
- Per-country tax categorization
- Jurisdiction-specific disclaimer
- Currency mappings
- `getTaxTemplate(jurisdiction)` - Get localized template
- `getJurisdictionTemplateOptions()` - List all jurisdictions

#### `tin-validation.ts`
TIN validation and formatting:
- Format validation per country
- Invalid pattern detection (e.g., all-zero SSN)
- Format/unformat for display
- Error messages with examples
- `validateTIN(tin, jurisdiction)` - Validate format
- `formatTIN(tin, jurisdiction)` - Format for display
- `getJurisdictionOptions()` - List with labels

### API Client (`api/tax-report.ts`)

```typescript
// Get summary with breakdown
getTaxReportSummary(year, jurisdiction, token): Promise<TaxReportSummary>

// Download full report
getTaxReportData(year, format, jurisdiction, token): Promise<TaxReportData | Blob>

// Save tax settings
saveTaxSettings(settings, token): Promise<void>

// Load tax settings
getTaxSettings(token): Promise<TaxSettings>
```

## Data Flow

```
User navigates to Tax Settings
    ↓
Loads saved jurisdiction + TIN (masked)
    ↓
User enters/updates TIN
    ↓
TIN validated per jurisdiction (client-side)
    ↓
User clicks Save
    ↓
POST /api/tax-settings { jurisdiction, tin, format }
    ↓
Backend encrypts TIN, stores in database
    ↓
✓ Settings saved
    ↓
User navigates to Download Report
    ↓
Selects year + jurisdiction
    ↓
GET /api/tax-reports/summary?year=2024&jurisdiction=US
    ↓
Backend builds report with encryption keys
    ↓
Returns TaxReportSummary with categories + amounts
    ↓
UI displays preview + breakdown chart
    ↓
User clicks Download
    ↓
GET /api/tax-reports?year=2024&format=csv&jurisdiction=US
    ↓
Backend generates report with full transaction data
    ↓
Returns CSV/PDF blob
    ↓
Browser downloads file
```

## TIN Validation Rules

### US SSN
- Format: `XXX-XX-XXXX` or `XXXXXXXXX`
- Regex: `^\d{3}-\d{2}-\d{4}$|^\d{9}$`
- Invalid patterns:
  - All zeros: `000-00-0000`
  - All same: `111-11-1111`, `666-66-6666`
  - Group number (middle) all zeros: `XXX-00-XXXX`
  - Serial number all zeros: `XXX-XX-0000`

### UK NINO
- Format: `AB123456C`
- Regex: `^[A-Z]{2}[0-9]{6}[A-Z]$`
- Case-insensitive

### Canada SIN
- Format: `XXX-XXX-XXX` or `XXXXXXXXX`
- Regex: `^\d{3}-\d{3}-\d{3}$|^\d{9}$`

### Australia TFN
- Format: `XXX XXX XXX` or `XXXXXXXXX`
- Regex: `^\d{3} \d{3} \d{3}$|^\d{9}$`

### India PAN
- Format: `XXXXXAXXXX`
- Regex: `^[A-Z]{5}[0-9]{4}[A-Z]{1}$`
- Example: `AAAAA0000A`

### Singapore NRIC/FIN
- Format: `XXXYYYYZZZZ` (e.g., `S1234567A`)
- Regex: `^[STNFG]\d{7}[A-Z]$/i`
- Prefix: S (Citizen), T/F (Foreigner), N (Not registered), G (Foreign worker)

## CSV Export Format

### Headers
```csv
Tax Report - US 2024
Generated: 12/15/2024

SUMMARY
Total Invested,50000
Total Gain/Loss,5000
Total Fees,100

TRANSACTION DETAILS
Deal Name,Invested Amount,Return Received,Net Gain/Loss,Fees,Currency,Closed At
"Premium Cocoa - Ghana",10000,12000,2000,50,USD,2024-06-30
```

## PDF Export
- Print-friendly layout
- Summary section with key metrics
- Tax breakdown chart
- Transaction details table
- Jurisdiction-specific disclaimer
- Generated date and year

## Testing

### Unit Tests
```bash
npm test -- tin-validation.test.ts
npm test -- TaxSettings.test.tsx
```

Coverage:
- TIN validation for all 8 jurisdictions
- Invalid pattern detection
- Format/unformat operations
- Tax settings save/load
- Error messages
- Privacy/security features

### Integration Tests
```bash
npm test -- tax-reporting.integration.test.tsx
```

Coverage:
- End-to-end tax report flow
- CSV/PDF generation
- Multiple jurisdiction workflows
- Settings persistence
- Security validations

## Security Considerations

### Client-Side
- TIN validated client-side before sending
- No TIN storage in localStorage (sessionStorage only during edit)
- Masked display after save

### Server-Side
- TIN encrypted with AES-256-GCM
- Encrypted key stored separately
- TIN only decrypted for report generation
- Report endpoint requires authentication
- Audit log on TIN access

### Data Privacy
- Comply with GDPR (right to erasure for TIN)
- Comply with CCPA (data access requests)
- No TIN sharing with third parties
- Optional TIN (can be empty)

## Compliance

### Tax Authority Alignment
- **US (IRS)**: Capital gains treatment, holding periods
- **UK (HMRC)**: CGT allowance, dividend tax credit
- **Canada (CRA)**: 50% inclusion rate for capital gains
- **Australia (ATO)**: 50% CGT discount for long-term
- **EU**: Member-state variations noted
- **India (ITR)**: LTCG/STCG distinction (2-year holding)
- **Singapore (IRAS)**: Favorable capital gains treatment

### Disclaimer Pattern
All reports include:
- "For informational purposes only"
- "Not professional tax advice"
- "Consult a [jurisdiction] tax advisor"
- Relevant tax rule explanations per country

## Future Enhancements

1. **Scheduled Reports** - Automatic generation on request (weekly/monthly)
2. **Multi-Jurisdiction** - Compare tax scenarios across countries
3. **Withholding Tax** - Track W-8BEN-E for US investors
4. **Tax Loss Harvesting** - Identify losses for tax optimization
5. **Estimated Payments** - Calculate quarterly tax payments
6. **Export to Tax Software** - Direct import to TurboTax, TaxAct, etc.
7. **Professional Review** - Partner with tax advisors for verification
8. **Audit Trail** - Record all report generations for compliance

## Configuration

### Environment Variables
```
NEXT_PUBLIC_TAX_REPORT_API=/api/tax-reports
TAX_ENCRYPTION_KEY=<AES-256 key for backend>
TAX_RETENTION_YEARS=7  # How long to keep reports
```

### Supported Years
- Current year - 4 (default: 2020-2024)
- Configurable per deployment

## Related Features

- **User Dashboard** - Tax settings accessible from investor profile
- **Portfolio Reports** - Complementary investment performance reporting
- **Document Download** - Reuses export utilities (CSV blob generation)
- **User PII** - TIN stored in `users.tax_identification` (encrypted)

## Localization

All templates support multiple languages (future):
- Jurisdiction labels translated
- Tax category descriptions localized
- Disclaimers in user's preferred language
- Export filenames with locale code: `tax-report-US-2024-en.pdf`
