# PR: Referral analytics, KYC jurisdiction matrix, accessible onboarding tour, farmer weekly digest

## Summary

- **#1018** — Referral conversion funnel and reward analytics in the dashboard
- **#1019** — Country-level KYC rules matrix (document types per jurisdiction)
- **#1020** — Accessibility-guided onboarding (keyboard-first tour) for new investors
- **#1021** — Email digest for farmers — weekly deal activity summary

closes #1018
closes #1019
closes #1020
closes #1021

---

### #1018 feat(frontend): Referral conversion funnel and reward analytics in the dashboard

- Registered `ReferralsModule` and shipped authenticated `GET /v1/referrals/analytics`
- Funnel math (clicks → signups → activated) with per-channel breakdowns, reward accrual timeline, and payout status summary
- Persisted `channel` + `payout_status` on referrals (migration)
- Investor dashboard `ReferralDashboard` (Recharts) shows funnel bars, accrual chart, channel table, and payout status cards
- Unit tests for funnel conversion rates, timeline aggregation, and payout status

### #1019 feat(backend): Compliance — country-level KYC rules matrix

- Config-driven `kyc_jurisdiction_rules` table with seeded NG/KE/GH/US/GB rules
- `GET /v1/kyc/requirements` and `GET /v1/kyc/matrix` for dynamic form metadata
- Admin CRUD at `/v1/admin/kyc-rules` with versioning + immutable audit log entries
- `POST /v1/auth/kyc` validates submissions against the active jurisdiction rule when `countryCode` is provided
- Unit tests covering required docs, accepted ID types, ID number patterns, and corporate vs individual paths

### #1020 feat(frontend): Accessibility-guided onboarding (keyboard-first tour)

- Shepherd tour is keyboard-operable (`keyboardNavigation`, `exitOnEsc`, focus on primary CTA)
- Persistent polite ARIA live region announces step progress for screen readers
- WCAG 2.1 AA contrast styles for tour highlights and buttons
- Reduced-motion path keeps content (disables animation only)
- Vitest coverage for live region + Playwright axe-core suite for the tour flow

### #1021 feat(backend): Email digest for farmers — weekly deal activity summary

- Weekly Monday 07:00 (farmer timezone) cron continues via `DealDigestService`
- Aggregation now includes funding pace, confirmed investments only, milestones due, and milestones logged from `shipment_milestones`
- Opt-in respected via `email_digest_enabled`; `GET/PATCH /users/me/preferences` for digest prefs
- Localized Handlebars templates (en/es/fr/pt/sw)
- Expanded unit tests for aggregation math, opt-out, timezone scheduling, and dedupe

## Test plan

- [ ] Run `backend` unit tests for `referral-tracking.service.spec.ts`, `kyc-rules.service.spec.ts`, `deal-digest.service.spec.ts`
- [ ] Run frontend Vitest `DashboardTour.test.tsx`
- [ ] Manually open investor dashboard → referral funnel charts render
- [ ] `GET /v1/kyc/requirements?country=NG&customerType=individual` returns metadata
- [ ] Submit KYC with wrong docs for NG → 400 with matrix errors
- [ ] Restart dashboard tour → Tab/Enter/Escape work; live region updates; axe clean
- [ ] Farmer with `emailDigestEnabled=true` gets digest aggregation; opted-out farmer skipped
