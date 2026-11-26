# ADR-007: Dual Escrow Path Reconciliation and Horizon Settlement Authority

* **Status:** Accepted
* **Date:** 2026-11-21
* **Authors:** Agri-Fi Core Architecture Team (Akpamgbo)

---

## 1. Context and Problem Statement

The platform previously maintained two parallel escrow release implementations:
1. **Horizon path**: `EscrowService.processDealDelivered()` calling `StellarService.releaseEscrow()` using classic Stellar transactions and Claimable Balances.
2. **Soroban path**: `blockchain/contracts/escrow/src/lib.rs` implementing an on-chain milestone escrow contract.

The Soroban contract split funds 98% to the farmer and 2% to the platform treasury, but did not implement proportional payouts across variable investor rosters, nor could it create Stellar Claimable Balances for investors whose wallets lack USDC trustlines.

As a result, deal settlement was executing on the Horizon path while the Soroban contract release entrypoints (`settle_escrow`, `release`) remained uninvoked post-milestone confirmation.

---

## 2. Decision Outcome

We decided that **Horizon-based `EscrowService` is the sole authoritative settlement engine** for all deal fund releases:

1. **Authoritative Financial Settlement**:
   - `EscrowService.processDealDelivered()` and `StellarService.releaseEscrow()` execute all farmer payouts, co-farmer splits, investor distributions, and platform protocol fees.
   - Payouts to investors lacking USDC trustlines are atomically created as Stellar Claimable Balances (`claimableBalance`), ensuring 100% payout reliability without trustline prerequisites.

2. **Role of Soroban Escrow Contract**:
   - The Soroban escrow contract is classified as a **secondary audit layer and milestone attestation registry**.
   - Soroban escrow contracts are not deployed for financial custody at deal approval time; this avoids deploying unused custodial contracts while preserving the Soroban indexing service for campaign milestone tracking.

3. **Codebase Labeling**:
   - The Soroban contract and indexing documentation are explicitly labeled as audit/milestone indexing layers to prevent architectural confusion.

---

## 3. Consequences

### Positive Consequences
- **Unambiguous Source of Truth**: Financial distribution and accounting have a single, authoritative execution path.
- **Trustline Resilience**: Investor funds are never locked or rejected due to missing trustlines.
- **Operational Simplicity**: On-chain and database reconciliation monitors a single Horizon transaction stream.

### Trade-offs
- The Soroban contract does not act as a custodial multi-sig vault for raw USDC tokens; custody is managed by the deal's Stellar escrow keypair with multisig controls.
