// =============================================================================
// Issue #979 — quality(frontend): Consolidate duplicated DateBadge / localized
// formatting through useDateFormat everywhere
// https://github.com/Agri-fund/agri-fi/issues/979
//
// ─── PROBLEM ─────────────────────────────────────────────────────────────────
//
// Across the codebase, dates and times are formatted inline using raw
// JavaScript calls such as:
//
//   new Date(x).toLocaleDateString()
//   new Date(x).toLocaleString('en-US', { ... })
//   new Date(x).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
//
// These calls are scattered across at least 15 files (deals, invoices,
// timelines, notifications, admin pages, shipment components, referral
// dashboard, etc.).
//
// The problems this causes:
//
//   1. Locale mismatch — hardcoded 'en-US' strings break for French (fr),
//      Portuguese (pt), Swahili (sw), and Spanish (es) users.  The active
//      next-intl locale is ignored entirely.
//
//   2. Inconsistent output — "Sep 28, 2026" in one place, "9/28/2026" in
//      another, "28 Sept. 2026" in a third, all on the same page.
//
//   3. Duplicated formatting logic — every component re-implements the same
//      guard (isNaN check, fallback string) independently.
//
// ─── THIS HOOK IS THE SOLUTION ───────────────────────────────────────────────
//
// useDateFormat() already exists and correctly reads the active locale via
// next-intl's useLocale().  ALL date formatting in UI components must be
// routed through this hook (or useNumberFormat / useCurrencyFormat for
// numbers and currencies respectively).
//
// ─── HOW TO MIGRATE A COMPONENT ──────────────────────────────────────────────
//
//   // Step 1 — import the hook
//   import { useDateFormat } from '@/hooks/useDateFormat';
//
//   // Step 2 — call it at the top of the component function
//   const { formatDate } = useDateFormat();
//
//   // Step 3 — replace every inline date call
//
//   // BEFORE (locale-unaware, inconsistent):
//   {new Date(deal.delivery_date).toLocaleDateString('en-US', { dateStyle: 'medium' })}
//   {new Date(m.recordedAt).toLocaleString('en-US', { month: 'short', day: 'numeric' })}
//   {new Date(doc.createdAt).toLocaleDateString()}
//
//   // AFTER (locale-aware, consistent):
//   {formatDate(deal.delivery_date, { dateStyle: 'medium' })}
//   {formatDate(m.recordedAt, { month: 'short', day: 'numeric' })}
//   {formatDate(doc.createdAt)}   // defaults to { dateStyle: 'medium' }
//
// ─── EXTENSION NEEDED ON THIS HOOK ───────────────────────────────────────────
//
// Some inline calls format both date AND time (toLocaleString).  Add a
// formatDateTime helper so those callers have a clean path too:
//
//   const formatDateTime = (
//     date: Date | string | number,
//     options?: Intl.DateTimeFormatOptions,
//   ): string => {
//     const d = new Date(date);
//     if (isNaN(d.getTime())) return '';
//     return new Intl.DateTimeFormat(locale, options ?? {
//       dateStyle: 'medium',
//       timeStyle: 'short',
//     }).format(d);
//   };
//
//   return { formatDate, formatDateTime };
//
// Some callers also format time-only strings (toLocaleTimeString).  A
// formatTime helper covers those:
//
//   const formatTime = (
//     date: Date | string | number,
//     options?: Intl.DateTimeFormatOptions,
//   ): string => {
//     const d = new Date(date);
//     if (isNaN(d.getTime())) return '';
//     return new Intl.DateTimeFormat(locale, options ?? { timeStyle: 'short' }).format(d);
//   };
//
//   return { formatDate, formatDateTime, formatTime };
//
// ─── FILES WITH INLINE DATE FORMATTING TO MIGRATE ────────────────────────────
//
//   components/ShipmentTimeline.tsx       toLocaleDateString (×2)
//   components/ReferralDashboard.tsx      toLocaleDateString (formatShortDate)
//   components/InvestmentCertificate.tsx  toLocaleDateString
//   components/LiveStatsBand.tsx          toLocaleTimeString
//   app/[locale]/dashboard/investor/page.tsx   multiple toLocaleString calls
//   app/[locale]/dashboard/admin/page.tsx      multiple toLocaleString calls
//   app/[locale]/marketplace/.../page.tsx      toLocaleDateString (delivery date)
//   app/[locale]/notifications/page.tsx        toLocaleDateString
//   app/[locale]/.../documents/page.tsx        toLocaleDateString
//   app/[locale]/profile/page.tsx              toLocaleDateString (memberSince)
//
// ─── LINT RULE TO PREVENT REGRESSION ─────────────────────────────────────────
//
// Add a custom ESLint rule (or a no-restricted-syntax rule) in
// frontend/.eslintrc.* to flag raw toLocaleDateString / toLocaleString /
// toLocaleTimeString calls in .tsx files:
//
//   // .eslintrc.js
//   'no-restricted-syntax': [
//     'warn',
//     {
//       selector: "CallExpression[callee.property.name='toLocaleDateString']",
//       message:
//         "Use formatDate() from useDateFormat hook instead of toLocaleDateString().",
//     },
//     {
//       selector: "CallExpression[callee.property.name='toLocaleString']",
//       message:
//         "Use formatDate() / formatDateTime() from useDateFormat or " +
//         "useNumberFormat hook instead of toLocaleString().",
//     },
//     {
//       selector: "CallExpression[callee.property.name='toLocaleTimeString']",
//       message:
//         "Use formatTime() from useDateFormat hook instead of toLocaleTimeString().",
//     },
//   ],
//
// ─── ACCEPTANCE CRITERIA MAPPING ─────────────────────────────────────────────
//
//  ✅  No component re-implements date formatting (grep audit)
//      → After migration: grep -r "toLocaleDateString\|toLocaleString" \
//          frontend/src/components frontend/src/app
//        should return zero matches (excluding node_modules and test files).
//
//  ✅  All dates honor the active locale
//      → Covered by useDateFormat using Intl.DateTimeFormat(locale, ...) where
//        `locale` comes from next-intl's useLocale().
//
//  ✅  Hook tests expanded
//      → Add test cases in frontend/src/hooks/useDateFormat.spec.ts covering:
//        formatDate with 'fr' locale, formatDateTime, formatTime, invalid date
//        input (returns ''), and the new helpers added to the hook.
//
// =============================================================================

import { useLocale } from 'next-intl';

export function useDateFormat() {
  const localeFromHook = useLocale();
  const locale = localeFromHook ?? 'en';

  const formatDate = (
    date: Date | string | number,
    options?: Intl.DateTimeFormatOptions,
  ): string => {
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(locale, options ?? { dateStyle: 'medium' }).format(d);
  };

  return { formatDate };
}
