# ADR-005: Per-Deal Issuer Keypair Management

* **Status:** Accepted
* **Date:** 2026-09-25
* **Authors:** Agri-Fi Core Architecture Team

---

## 1. Context and Problem Statement

Agri-Fi tokenizes agricultural produce deals as custom assets on the Stellar network (e.g. `COCOA1002`).

If a single platform master account is used to issue asset tokens across all trade deals:
- A compromise of the master issuer key compromises *all* active and past trade deals on the platform.
- Asset supply limits and authorization flags (e.g. `auth_required`, `auth_revocable`) cannot be isolated per trade deal.

---

## 2. Decision Outcome

We adopted a **Per-Deal Issuer Keypair** architecture.

Key details:
1. Every trade deal published on Agri-Fi dynamically generates a dedicated Stellar `Keypair` (`issuerPublicKey` & `issuerSecretKey`).
2. The issuer secret key is encrypted at rest in PostgreSQL using AES-256-GCM.
3. The issuer account mints the exact total token supply matching the deal's total value (e.g. 1,000 tokens for a $100,000 deal at $100/token) to the escrow account, and then locks supply by setting the issuer master weight to 0.
4. Each deal maintains strict cryptographic isolation on-chain.

---

## 3. Consequences

### Positive Consequences
- **Blast Radius Limitation:** Compromise or key loss of a single deal issuer keypair cannot affect other trade deals.
- **On-chain Auditing:** Token issuers maintain 1:1 mapping with specific deal assets on Horizon block explorers.
- **Immutability:** Setting issuer master weight to 0 guarantees no further tokens for that deal asset can ever be minted.

### Negative Consequences / Trade-offs
- **Account Funding Reserve:** Each issuer account requires initial XLM base reserve funding on Stellar testnet/mainnet.
- **Key Storage Management:** The database must store and manage encrypted secret keys for every trade deal created.

---

## 4. Alternatives Considered

1. **Option 1: Single Platform Master Issuer Key**
   - *Pros:* Simpler key management, lower XLM base reserve cost.
   - *Cons:* Single point of failure across entire platform asset inventory.
   - *Reason for rejection:* Unacceptable risk profile for financial asset tokenization.

2. **Option 2: User Wallet as Asset Issuer**
   - *Pros:* Non-custodial issuance by trader.
   - *Cons:* Traders may fail to follow supply lock requirements or misuse issuer options.
   - *Reason for rejection:* Platform requires strict compliance control over token supply cap.
