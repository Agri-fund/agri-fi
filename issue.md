#829 bug(frontend): InvestmentForm submits duplicate requests on slow connections
Repo Avatar
Agri-fund/agri-fi
Bug Report
Summary
On slow network connections, users who click the Invest button multiple times before the first response arrives cause multiple POST /investments requests to be fired. This results in duplicate investment records in the database.

Steps to Reproduce
Open InvestmentForm on a deal page
Use DevTools to throttle network to Slow 3G
Click the Invest button 3 times quickly
Observe 3 investment records created for the same deal
Expected Behaviour
Only one investment should be created. Subsequent clicks while the request is in-flight should be ignored.

Root Cause
InvestmentForm does not disable the submit button or track in-flight state after the first click.

Acceptance Criteria
 Submit button disabled immediately on first click
 Button shows loading spinner while request is in-flight
 Button re-enabled only if the request fails (to allow retry)
 Backend idempotency key (idempotency.service.ts) added to the POST as a secondary guard
 Unit test for form submission state machine
 Cypress/Playwright test simulating slow network and multiple clicks

 #828 feat(trade-deals): Risk scoring engine for agricultural deals
Repo Avatar
Agri-fund/agri-fi
Feature Request
Summary
Introduce an automated risk scoring engine that evaluates each trade deal along multiple dimensions and assigns a composite risk rating (Low / Medium / High / Very High) displayed to investors before they commit funds.

Motivation
Investors currently have no standardised risk signal. A transparent scoring model builds trust and supports regulatory disclosure requirements.

Scoring Dimensions
Dimension	Weight	Data Source
Farmer historical repayment	25%	investments table
Commodity price volatility	20%	prices.service.ts
Geographic weather risk	20%	external weather API
Deal duration	15%	trade_deals.duration
Collateral coverage ratio	20%	deal metadata
Acceptance Criteria
 RiskScoringService in trade-deals module computes score on deal create/update
 Score persisted to trade_deals.risk_score column (new migration)
 Score recalculated nightly by cron
 Score and breakdown returned in GET /trade-deals/:id response
 Risk badge displayed on deal card and detail page (frontend)
 Score change events emitted to audit log
 Unit tests for each scoring dimension
 OpenAPI schema updated

 #827 feat(auth): Implement TOTP-based MFA with QR code enrollment
Repo Avatar
Agri-fund/agri-fi
Feature Request
Summary
Add TOTP (Time-based One-Time Password) as the primary MFA method, allowing users to enrol via any authenticator app (Google Authenticator, Authy, 1Password) by scanning a QR code.

Motivation
The current MFA implementation (mfa.guard.ts, mfa.dto.ts) has stubs but no actual TOTP verification logic. This leaves the MFA guard essentially non-functional for new enrollments.

Detailed Requirements
Backend
 Generate TOTP secret per user on enrollment using otplib
 Store encrypted secret in the users table (use existing encryption.transformer)
 POST /auth/mfa/enroll — returns QR code data URI and backup codes
 POST /auth/mfa/verify — verifies 6-digit TOTP and marks MFA as active
 POST /auth/mfa/disable — requires current TOTP code + password confirmation
 Backup codes: 8 single-use codes hashed with bcrypt
 mfa.guard.ts fully implemented to enforce TOTP check post-login
Frontend
 MFA enrollment screen in account settings with QR code display
 Numeric input for 6-digit code with auto-submit on 6th digit
 Backup codes displayed once and downloadable as PDF
 Login step-up screen when MFA is required
Security
 TOTP window limited to ±1 step (30s tolerance)
 Used TOTPs tracked in Redis to prevent replay within the same window
 Rate limit: max 5 wrong TOTP attempts before 10-minute lockout
Acceptance Criteria
 E2E test: enroll, verify, login with TOTP, disable
 Audit log entries for every MFA lifecycle event
 Docs updated in backend/docs/API.md

#826 bug(escrow): Escrow release silently fails when Stellar network fee exceeds base reserve
Repo Avatar
Agri-fund/agri-fi
Bug Report
Summary
When the Stellar network is congested and the base fee surges above the configured STELLAR_BASE_FEE environment variable, the escrow release transaction is submitted but silently rejected by Horizon with tx_insufficient_fee. The backend logs no error and the investment stays in RELEASING state indefinitely.

Steps to Reproduce
Set STELLAR_BASE_FEE=100 (default)
Simulate fee surge (network congestion or test with fee bump)
Trigger an escrow release
Observe investment stuck in RELEASING with no alert
Expected Behaviour
The escrow service should detect tx_insufficient_fee, retry with fee bumping up to a configurable max fee, and alert if the max fee is exceeded.

Root Cause (suspected)
escrow.service.ts does not inspect the Horizon error code from the submission response before marking the job as complete.

Acceptance Criteria
 Parse Horizon result codes after submission; treat tx_insufficient_fee as retryable
 Implement fee-bump retry with exponential increase up to STELLAR_MAX_FEE env var
 After max retries exhausted, move job to DLQ and fire a priority-high alert
 Unit tests covering fee surge simulation
 Integration test confirming stuck state is resolved after fee bump