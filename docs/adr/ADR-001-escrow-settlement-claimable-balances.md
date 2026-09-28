# ADR-001: Escrow 98/2 Settlement with Claimable Balances

* **Status:** Accepted
* **Date:** 2026-09-25
* **Authors:** Agri-Fi Core Architecture Team

---

## 1. Context and Problem Statement

Agri-Fi facilitates agricultural trade deal financing on the Stellar blockchain. When an investor funds a deal, capital must be safely held until shipment milestones are completed. Upon confirmation of the final `Importer` milestone, funds must be settled with:
- 98% distributed to the produce farmer.
- Proportional return payouts to investors.
- 2% protocol service fee retained by the platform.

Direct live payouts on mainnet/testnet require managing recipient account readiness. If a farmer or investor account does not exist or lacks a trustline for the payment asset, direct payment transactions will fail on-chain.

---

## 2. Decision Outcome

We decided to use **Stellar Claimable Balances (`claimableBalance`)** for the 98/2 settlement distribution pattern instead of immediate direct token transfers.

Key implementation details:
- Upon milestone completion, the escrow account creates Stellar claimable balance entries with predicate conditions (`beforeAbsoluteTime` or unconditional claimability).
- 98% of proceeds are designated for the farmer's public key.
- 2% is deposited into the platform fee treasury.
- Recipients pull/claim their allocated balance when ready, eliminating recipient trustline pre-requisite failures during settlement execution.

---

## 3. Consequences

### Positive Consequences
- **Transaction Atomicity:** Escrow settlement transactions succeed atomically without failing due to missing recipient trustlines or uninitialized target accounts.
- **De-coupled Execution:** Recipients can claim funds asynchronously at their convenience.
- **On-chain Auditability:** Every claimable balance creation creates an immutable record on Stellar ledger history.

### Negative Consequences / Trade-offs
- **User UX Friction:** Claimants must execute an additional `claimClaimableBalance` operation (or use platform sponsored claim helpers) to receive funds into their primary account balance.

---

## 4. Alternatives Considered

1. **Option 1: Direct `payment` operations to farmer and investor accounts**
   - *Pros:* Instant credit to user account balance.
   - *Cons:* Fails if recipient account lacks trustline or base reserve.
   - *Reason for rejection:* Unacceptable failure rate during automated settlement execution.

2. **Option 2: Custodial DB balance accounting**
   - *Pros:* High throughput, zero on-chain fee.
   - *Cons:* Loss of non-custodial trust and on-chain transparency.
   - *Reason for rejection:* Violates core platform requirement for non-custodial on-chain escrow transparency.
