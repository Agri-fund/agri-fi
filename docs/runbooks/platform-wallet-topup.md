# Platform Fee Wallet Top-up Runbook

## Overview
The platform fee wallet (`STELLAR_PLATFORM_PUBLIC_KEY`) pays transaction fees and maintains reserves for escrow releases and contract interactions. If the balance drops near the network minimum reserve, operations fail with `op_low_reserve`.

## Alert Thresholds
- **Warning (< 50 XLM):** Triggers PagerDuty warning and alerts `#stellar-alerts` on Slack.
- **Critical (< 10 XLM):** Triggers high-priority PagerDuty page. Escrow settlements at imminent risk of failure.

## Procedure
1. Identify current wallet balance via Horizon or block explorer.
2. Transfer XLM from the treasury hot-wallet to the platform fee wallet.
3. Target minimum balance: >= 500 XLM.
4. Verify `PlatformWalletMonitorService` logs return to healthy (`none`).
