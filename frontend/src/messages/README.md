# Translation Catalogs

This directory contains translation files for the AgriFi platform in multiple languages.

## Supported Languages

- **en.json** - English (source language)
- **fr.json** - French
- **sw.json** - Swahili
- **pt.json** - Portuguese (incomplete)

## Files

### Translation Files

- `en.json` - English translations (135 keys)
- `fr.json` - French translations (135 keys)
- `sw.json` - Swahili translations (135 keys)
- `pt.json` - Portuguese translations (12 keys - **INCOMPLETE**)

### Test Files

- `i18n.spec.ts` - Comprehensive translation validation test suite
- `TRANSLATION_TEST_REPORT.md` - Detailed test report and findings

## Translation Structure

Translations are organized hierarchically:

```json
{
  "nav": {
    "title": "...",
    "dashboard": "...",
    "roles": {
      "farmer": "..."
    }
  },
  "home": {
    "title": "...",
    "hero": {
      "titlePart1": "..."
    }
  },
  "deals": { ... },
  "common": { ... },
  "format": { ... }
}
```

## Key Categories

- **nav** - Navigation menu items
- **home** - Homepage content, hero section, features, roles, steps, transparency, CTA
- **deals** - Trade deal creation and validation messages
- **common** - Common UI messages (loading, error, success, etc.)
- **format** - Number and date formatting patterns

## Running Tests

```bash
# Run all translation tests
npm test -- src/messages/i18n.spec.ts

# Run specific test suite
npm test -- src/messages/i18n.spec.ts -t "Key Completeness"

# Run with verbose output
npm test -- src/messages/i18n.spec.ts --verbose
```

## Test Coverage

The test suite validates:

1. **Key Completeness** - All locales have identical keys
2. **Required Keys** - Critical keys exist in English
3. **Structure Consistency** - Matching nesting depth
4. **Empty Values** - No blank translations
5. **Placeholder Consistency** - Matching interpolation variables
6. **Catalog Statistics** - Key count reporting

## Current Status

| Language   | Keys | Status                      |
| ---------- | ---- | --------------------------- |
| English    | 135  | ✅ Complete                 |
| French     | 135  | ✅ Complete                 |
| Swahili    | 135  | ✅ Complete                 |
| Portuguese | 12   | ❌ Incomplete (123 missing) |

## Adding New Translations

1. Add the key to `en.json` with English text
2. Add the same key to all other locale files with translated text
3. Ensure placeholders match (e.g., `{count}`, `{value, number, currency}`)
4. Run tests to validate: `npm test -- src/messages/i18n.spec.ts`

## Placeholder Variables

Common placeholders used in translations:

- `{count}` - Numeric count
- `{amount}` - Monetary amount
- `{year}` - Current year
- `{value, number, currency}` - Formatted currency
- `{value, date, short}` - Formatted date
- `{value, number}` - Formatted number
- `{remaining}` - Remaining count
- `{total}` - Total count
- `{price}` - Price value
- `{brand}` - Brand name

## Troubleshooting

### Missing Translation Keys

If you see empty placeholders in the UI, run the test suite to identify missing keys:

```bash
npm test -- src/messages/i18n.spec.ts
```

### Placeholder Mismatches

The test will report if placeholders don't match between locales. Ensure all interpolation variables are identical.

### Empty Values

The test detects empty string values that would show as blank in the UI. Check the test output for details.

## Integration with i18n

These translation files are used with `next-intl` for internationalization in the Next.js application. The key structure directly maps to component usage:

```tsx
import { useTranslations } from "next-intl";

export function Component() {
  const t = useTranslations();
  return <h1>{t("home.title")}</h1>;
}
```

## Contributing

When adding new features:

1. Add English translations first
2. Add translations for all supported languages
3. Run the test suite to validate
4. Commit all translation files together
