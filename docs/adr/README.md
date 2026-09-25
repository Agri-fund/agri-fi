# Architecture Decision Records (ADR)

This directory contains the record of significant architectural decisions made in the Agri-Fi platform.

## Index of ADRs

| ADR | Title | Status | Date |
|---|---|---|---|
| [ADR-000](./ADR-000-template.md) | Architecture Decision Record Template | Template | 2026-09-25 |
| [ADR-001](./ADR-001-escrow-settlement-claimable-balances.md) | Escrow 98/2 Settlement with Claimable Balances | Accepted | 2026-09-25 |
| [ADR-002](./ADR-002-transactional-outbox-dlq.md) | Transactional Outbox Pattern and Dead Letter Queue (DLQ) | Accepted | 2026-09-25 |
| [ADR-003](./ADR-003-postgres-row-level-security.md) | Postgres Row Level Security (RLS) & RLS Service | Accepted | 2026-09-25 |
| [ADR-004](./ADR-004-queue-aes-gcm-encryption.md) | Queue Encryption via AES-GCM Envelope Encryption | Accepted | 2026-09-25 |
| [ADR-005](./ADR-005-per-deal-issuer-keypair-management.md) | Per-Deal Issuer Keypair Management | Accepted | 2026-09-25 |

---

## When and How to Write an ADR

Whenever you propose or make a significant architectural choice (e.g. changing state management, selecting database storage patterns, security encryption schemes, queue protocols, or Stellar ledger interaction patterns):

1. Copy [`ADR-000-template.md`](./ADR-000-template.md) to `ADR-XXX-<short-name>.md`.
2. Fill in status, context, decision outcome, consequences, and alternatives considered.
3. Update this index table (`docs/adr/README.md`).
4. Include the ADR in your Pull Request for review.
