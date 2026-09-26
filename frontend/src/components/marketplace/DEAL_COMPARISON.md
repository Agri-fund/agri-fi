# Deal Comparison Feature

## Overview

The Deal Comparison feature lets investors compare up to 3 deals side-by-side. Investors can export comparisons to CSV, share links with others, and selections persist across sessions.

## Features

### 1. CSV Export
Download comparison table to CSV file with:
- All metrics (Expected ROI, Duration, Funding progress, Risk rating, etc.)
- Deal commodities as columns
- Properly formatted values
- Date-stamped filename: `deal-comparison-YYYY-MM-DD.csv`

**Button:** 📥 Export CSV

### 2. Shareable Links
Generate URL with comparison IDs for sharing:
- Format: `/marketplace?compare=deal-1,deal-2,deal-3`
- Recipients land on marketplace with comparison pre-loaded
- Works across browser instances
- Click to copy to clipboard

**Button:** 🔗 Share

### 3. Session Persistence
Comparisons automatically saved to `localStorage`:
- Restored when user revisits marketplace
- Key: `agri-fi:deal-comparison`
- Stores only deal IDs (minimal storage)
- Survives browser restart

## Usage

### Adding Deals to Comparison
Click "Compare" button on any deal card to add to comparison (max 3).

### CSV Export
1. Click 📥 Export CSV button in comparison panel
2. Browser downloads `deal-comparison-YYYY-MM-DD.csv`
3. Open in Excel/Google Sheets for analysis

### Sharing Comparison
1. Click 🔗 Share button
2. "Copied" confirmation appears
3. Share the copied URL with others
4. Recipients see same comparison when they visit

### Restoring from URL
Automatically happens when:
- User visits marketplace with `?compare=id1,id2,id3` params
- User revisits marketplace (from localStorage)

## Implementation

### Component: `DealComparison.tsx`

**Props:**
```typescript
{
  deals: Deal[];           // Array of deals to compare (max 3)
  onRemove: (id: string) => void;  // Remove deal from comparison
  onClear: () => void;    // Clear all comparisons
}
```

**Exports:**
```typescript
// Utilities for use in parent components
generateComparisonCSV(deals: Deal[]): string
generateShareLink(dealIds: string[], baseUrl: string): string
parseComparisonParams(compareParam: string | null): string[]

// Constants
COMPARISON_STORAGE_KEY: 'agri-fi:deal-comparison'
COMPARISON_URL_PARAM: 'compare'
```

### Parent Component: `marketplace/page.tsx`

**Integration:**
```typescript
// Restore comparison from URL params or localStorage
useEffect(() => {
  const compareParam = searchParams.get('compare');
  if (compareParam) {
    // Use deep link IDs
    sessionStorage.setItem('pending-comparison-ids', JSON.stringify(ids));
  } else {
    // Restore from localStorage
    const saved = localStorage.getItem('agri-fi:deal-comparison');
    if (saved) sessionStorage.setItem('pending-comparison-ids', JSON.stringify(JSON.parse(saved)));
  }
}, [searchParams]);

// Load deals and restore comparison
useEffect(() => {
  getOpenDeals(...).then((res) => {
    // Filter loaded deals to pending comparison IDs
    const pendingIds = sessionStorage.getItem('pending-comparison-ids');
    const dealsToCompare = res.data.filter((d) => compareIds.includes(d.id));
    setComparisonDeals(prev => [...prev, ...dealsToCompare].slice(0, 3));
  });
}, [urlPage]);
```

## Metrics Displayed

| Metric | Source | Format |
|--------|--------|--------|
| Expected ROI | `deal.expected_roi` | `24.5%` |
| Duration | `deal.duration_days` | `180 days` |
| Funding progress | `total_invested / total_value` | `50.0%` |
| Risk rating | `deal.risk_rating` | `Medium` |
| Commodity | `deal.commodity` | `Cocoa` |
| Total Value | `deal.total_value` | `$50,000` |
| Total Invested | `deal.total_invested` | `$25,000` |

## Data Flow

```
User clicks "Compare" on Deal Card
         ↓
setComparisonDeals adds deal (max 3)
         ↓
DealComparison receives deals array
         ↓
useEffect persists to localStorage
         ↓
generateShareLink creates ?compare=id1,id2,id3
         ↓
User clicks Share → URL copied to clipboard
         ↓
Recipient visits URL → parseComparisonParams extracts IDs
         ↓
marketplace/page.tsx restores deals from API
         ↓
DealComparison renders with restored deals
```

## Storage

### localStorage
- **Key:** `agri-fi:deal-comparison`
- **Format:** JSON array of deal IDs
- **Example:** `["deal-1", "deal-2", "deal-3"]`
- **Size:** < 100 bytes
- **Persistence:** Survives browser restart

### sessionStorage (Temporary)
- **Key:** `pending-comparison-ids`
- **Purpose:** Bridge between URL params and deal restoration
- **Cleared:** After deals are loaded and restored

## URL Parameters

### Deep Link Format
```
/marketplace?compare=deal-id-1,deal-id-2,deal-id-3
```

### Priority
1. URL `?compare` parameter (if present)
2. localStorage restoration (if no URL param)
3. Empty comparison (if neither)

### Multi-Parameter Support
```
/marketplace?compare=deal-1,deal-2&sortBy=roi&page=1
```
All parameters preserved together.

## CSV Format

### Headers
```csv
Metric,Cocoa,Maize,Coffee
```

### Data Rows
```csv
Expected ROI,24.5%,18.0%,22.0%
Duration,180 days,120 days,150 days
Funding progress,50.0%,66.7%,80.0%
Risk rating,Medium,Low,High
Commodity,Cocoa,Maize,Coffee
Total Value,"$50,000","$75,000","$100,000"
Total Invested,"$25,000","$50,000","$80,000"
```

### Escaping
- Strings containing commas wrapped in quotes: `"value with, comma"`
- Quotes inside strings escaped: `"value with ""quotes"""`

## Testing

### Unit Tests
```bash
npm test -- DealComparison.test.tsx
```

Covers:
- CSV generation and formatting
- Share link generation
- localStorage persistence
- URL parameter parsing
- Deep link behavior
- Remove/Clear functionality
- Value formatting

### Integration Tests
```bash
npm test -- marketplace-comparison.integration.test.tsx
```

Covers:
- localStorage restoration after reload
- URL parameter precedence
- CSV export consistency
- Multi-parameter URL handling
- Edge cases (null values, special characters)

## Accessibility

- **Keyboard Navigation:** All buttons keyboard accessible
- **ARIA Labels:** Remove buttons labeled with deal commodity
- **Screen Readers:** Table structure semantic (thead/tbody)
- **Focus Management:** Buttons visible on focus

## Performance

- **Storage:** ~50-100 bytes per 3 deals (just IDs)
- **CSV Generation:** O(n × m) where n = deals, m = metrics (~7 rows)
- **No Re-fetching:** Uses existing deal data from parent
- **Debouncing:** localStorage writes batched to single effect

## Browser Support

- **localStorage:** All modern browsers (IE 8+)
- **URL params:** All modern browsers
- **Clipboard API:** Chrome 63+, Firefox 53+, Safari 13.1+
  - Graceful fallback: If clipboard unavailable, can still show link in dialog

## Limitations

- **Max 3 Deals:** UI constraint for readability
- **Public URLs:** Share links unencrypted (IDs visible in URL)
- **Temporary Storage:** sessionStorage cleared on tab close
- **CSV Export:** Basic format (no styling, images)

## Future Enhancements

1. **Customizable Metrics:** Let users select which fields to compare
2. **Save Templates:** Save comparison presets for reuse
3. **PDF Export:** Print-friendly PDF instead of CSV
4. **Annotations:** Add notes to each deal in comparison
5. **Historical Comparisons:** Track comparison edits over time
6. **Public Comparisons:** Share comparison as permanent link (backend-persisted)
7. **Comparison Charts:** Visual charts (ROI, duration, risk distribution)
