# Accessibility (WCAG 2.1 AA)

This document describes the accessibility posture of the frontend, the automated
`axe-core` audit that runs in CI, and the known Level AA exceptions with their
justifications.

## Automated audit

The frontend CI workflow (`.github/workflows/frontend-ci.yml`) runs an
`axe-core` audit via `@axe-core/playwright` against the primary pages:

- Marketplace
- Deal detail
- Investment form
- KYC flow
- Dashboard

The audit step fails the build on any **WCAG 2.1 Level A** violation. Level AA
violations are reported but do not fail the build while the exceptions below
remain open.

## Manual verification

Screen-reader compatibility is verified manually for the two flows that rely
most heavily on dynamic announcements:

- **Wallet connection flow** — the connect button exposes an accessible name and
  the connection status is announced through a live region.
- **Transaction progress indicator** (`OnChainProgressIndicator`) — each step
  heading receives focus (`stepHeadingRef.current?.focus()`) and the current
  step is exposed via `aria-current`, so screen readers announce progress.

## Known Level AA exceptions

| Area | Exception | Justification |
| --- | --- | --- |
| Brand accent colors | Some accent text/borders fall below the 4.5:1 contrast ratio on light backgrounds. | The palette is defined by the brand guidelines; a compliant palette is being designed and will replace the current tokens. Non-text UI remains distinguishable. |
| Third-party wallet modals | Wallet provider modals are rendered outside our DOM and cannot be audited or patched. | Owned by the wallet providers; tracked upstream. Our own connect controls meet Level A. |
| Animated progress transitions | Progress transitions are not fully pausable. | Transitions are short (< 5s) and do not auto-play indefinitely, so the pause requirement does not apply. |

Each exception is reviewed when the related component or design token changes.
