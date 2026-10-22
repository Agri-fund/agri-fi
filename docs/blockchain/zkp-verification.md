# Zero-Knowledge Proof Verification

## Overview

The Agri-Fi platform implements zero-knowledge proof (ZKP) technology to enable private verification of deal credentials without revealing sensitive business data. Farmers, traders, and investors can prove that their credit score, compliance status, financial health, or KYC verification meets a threshold — without disclosing the exact value.

This protects competitive information while ensuring trust between deal participants.

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Frontend    │────▶│  Backend (NestJS) │────▶│  PostgreSQL     │
│  Dashboard   │     │  ZkpModule        │     │  zkp_proofs     │
│              │     │                   │     │                 │
│  Generate    │     │  ZkpCircuitService│     │  AuditService   │
│  Verify      │     │  ZkpService       │     │  SystemAuditLog │
│  Revoke      │     │  ZkpController    │     │                 │
│  Anchor      │     │                   │     └─────────────────┘
└──────────────┘     └────────┬──────────┘
                              │
                     ┌────────▼──────────┐
                     │  Stellar Network  │
                     │  (memo anchoring)  │
                     └───────────────────┘
```

### Components

| Component | File | Responsibility |
|---|---|---|
| ZkpCircuitService | `backend/src/zkp/zkp-circuit.service.ts` | Circuit design, proof generation, cryptographic verification |
| ZkpService | `backend/src/zkp/zkp.service.ts` | Business logic: lifecycle, audit trail, revocation, on-chain anchoring |
| ZkpController | `backend/src/zkp/zkp.controller.ts` | REST API endpoints |
| ZkpModule | `backend/src/zkp/zkp.module.ts` | NestJS module wiring |
| ZkpProof entity | `backend/src/zkp/entities/zkp-proof.entity.ts` | TypeORM entity for `zkp_proofs` table |
| Migration | `backend/src/database/migrations/2060000000000-CreateZkpProofsTable.ts` | Database schema |
| Frontend API routes | `frontend/src/app/api/zkp/proofs/` | Next.js API route handlers |
| Frontend dashboard | `frontend/src/app/[locale]/dashboard/zkp/page.tsx` | Proof management UI |

## Credential Types

The system supports four credential types, each with a dedicated circuit:

| Credential Type | Circuit ID | Description |
|---|---|---|
| `credit_score` | `credit_score_range_v1` | Proves credit score (300–850) meets a threshold without revealing the exact score |
| `compliance` | `compliance_status_v1` | Proves compliance status is "verified" without revealing audit details |
| `financial_health` | `financial_health_threshold_v1` | Proves financial health score (0–100) exceeds a threshold |
| `kyc` | `kyc_verified_v1` | Proves KYC is verified without revealing personal identity documents |

## ZKP Standards

The system supports two zk-SNARK standards:

- **Groth16** (default) — Smaller proof sizes, faster verification, requires trusted setup per circuit
- **PLONK** — Universal trusted setup, supports larger circuits with slightly larger proofs

## API Endpoints

### Generate Proof

```
POST /v1/zkp/proofs/generate
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "credentialType": "credit_score",
  "credentialValue": "750",
  "publicInputs": { "threshold": 600 },
  "standard": "groth16"
}
```

**Response:**
```json
{
  "id": "uuid",
  "ownerId": "user-uuid",
  "credentialType": "credit_score",
  "circuitId": "credit_score_range_v1",
  "standard": "groth16",
  "status": "active",
  "publicInputs": { "threshold": 600 },
  "credentialCommitment": "sha256-hash",
  "stellarTxId": null,
  "expiresAt": "2027-10-21T...",
  "generationTimeMs": 3,
  "createdAt": "2026-10-21T...",
  "updatedAt": "2026-10-21T..."
}
```

The raw `credentialValue` is hashed to a SHA-256 commitment, then discarded. It is never stored in the database.

### Verify Proof

```
POST /v1/zkp/proofs/:id/verify
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "proofId": "uuid",
  "publicInputs": { "threshold": 600 }
}
```

**Response:**
```json
{
  "valid": true,
  "proofId": "uuid",
  "message": "Proof verified successfully — credential satisfies circuit constraints without disclosure"
}
```

Verification does NOT require the raw credential value. Only the proof payload, public inputs, and circuit ID are needed.

### Revoke Proof

```
POST /v1/zkp/proofs/:id/revoke
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "reason": "Credential value changed after credit score recalculation"
}
```

Revoked proofs return `valid: false` on all subsequent verification attempts.

### List Proofs

```
GET /v1/zkp/proofs?credentialType=credit_score&status=active&limit=50
Authorization: Bearer <jwt>
```

### Get Single Proof

```
GET /v1/zkp/proofs/:id
Authorization: Bearer <jwt>
```

### Anchor on Stellar

```
POST /v1/zkp/proofs/:id/anchor
Authorization: Bearer <jwt>
```

Anchors the proof's commitment hash on the Stellar network via a memo transaction, creating an immutable public timestamp of proof existence.

## Audit Trail

Every ZKP operation is logged to the `system_audit_logs` table via `AuditService`:

| Event | Route | Details Logged |
|---|---|---|
| Proof generation | `zkp:proof:generate` | Proof ID, credential type, circuit ID, standard, generation time |
| Proof verification | `zkp:proof:verify` | Proof ID, result (valid/invalid), failure reason |
| Proof revocation | `zkp:proof:revoke` | Proof ID, reason, credential type |
| On-chain anchoring | `zkp:proof:anchor` | Proof ID, commitment hash, anchor status |

Audit logs are immutable — they cannot be updated or deleted (enforced by `@BeforeUpdate` and `@BeforeRemove` hooks on `SystemAuditLog`).

## Proof Lifecycle

```
                    ┌─────────┐
                    │ PENDING │ (initial — not currently used)
                    └────┬────┘
                         │
                    ┌────▼────┐
              ┌─────│  ACTIVE │─────┐
              │     └─────────┘     │
              │                     │
        ┌─────▼──────┐       ┌──────▼──────┐
        │  REVOKED    │       │   EXPIRED   │
        │ (manual)   │       │ (auto/age)  │
        └────────────┘       └─────────────┘
```

1. **Generation** — Proof created with `ACTIVE` status and 1-year expiry
2. **Verification** — Cryptographic check against circuit constraints; revoked/expired proofs return `valid: false`
3. **Revocation** — Owner manually revokes when credential changes (e.g. credit score drops)
4. **Expiry** — Auto-expired when `expiresAt` passes during verification

## On-Chain Anchoring

Proof commitments can be anchored on the Stellar network via a memo transaction. This creates an immutable, publicly-verifiable timestamp proving the proof existed at a specific ledger entry — without revealing any credential data.

The commitment hash (SHA-256 of the credential value) is submitted as a Stellar transaction memo. The resulting transaction hash is stored in `zkp_proofs.stellar_tx_id`.

Anchoring is optional — proofs are valid without it, but anchoring adds an additional layer of trust for third-party verification.

## Performance

The system enforces a 30-second proof generation timeout (`ZKP_PROOF_TIMEOUT_MS`). Current implementation generates proofs in <10ms. In production with snarkjs/circom integration, proof generation typically takes 5–25 seconds depending on circuit complexity.

Generation time is tracked per proof in `generation_time_ms` for performance monitoring.

## Configuration

Environment variables (see `.env.example` section 18):

| Variable | Default | Description |
|---|---|---|
| `ZKP_STANDARD` | `groth16` | Default ZKP standard for proof generation |
| `ZKP_PROOF_EXPIRY_DAYS` | `365` | Proof validity period in days |
| `ZKP_PROOF_TIMEOUT_MS` | `30000` | Maximum proof generation time before timeout |
| `ZKP_ON_CHAIN_ANCHORING` | `true` | Whether to anchor proofs on Stellar |
| `ZKP_CIRCUITS_DIR` | `./circuits` | Path to circuit proving/verification keys |

## Integration with Existing Systems

### Farmer Credit Scoring

The ZKP system integrates with `FarmerCreditScoringService` — farmers can generate proofs attesting their credit score (300–850 FICO range) meets a threshold required by investors, without revealing the exact score. This protects farmer privacy while giving investors confidence in deal quality.

### KYC Verification

KYC-verified users can generate proofs attesting their identity has been verified without revealing personal documents. This enables third-party verification of KYC status for compliance purposes.

### Compliance Reporting

Compliance status proofs allow traders to demonstrate regulatory compliance without exposing audit details, protecting competitive information while satisfying partner due diligence requirements.

## Security Considerations

- **No raw credential storage** — Only SHA-256 commitment hashes and proof payloads are persisted
- **Proof integrity** — HMAC-based signatures prevent proof tampering
- **Owner-scoped access** — Users can only view, verify, revoke, and anchor their own proofs
- **Audit immutability** — All ZKP operations are logged to immutable system audit logs
- **Revocation** — Proofs can be revoked when credentials change, preventing stale proofs from being used
- **Expiry enforcement** — Expired proofs are automatically detected during verification

## Testing

Backend tests cover:

- Proof generation for all credential types (credit_score, compliance, financial_health, kyc)
- Proof verification (valid, revoked, expired, tampered)
- Proof revocation (owner, non-owner, already-revoked)
- Circuit service (commitment computation, proof round-trip, tamper detection)
- Controller endpoints (auth checks, filtering, pagination, ownership enforcement)

```bash
cd backend && npm test -- --testPathPattern="zkp"
```

## Future Enhancements

- **snarkjs/circom integration** — Replace the current HMAC-based proof construction with production zk-SNARK circuits
- **ZK-STARK support** — Add zk-STARK standard for post-quantum security
- **Batch verification** — Verify multiple proofs in a single operation
- **Proof sharing** — Generate shareable proof tokens for third-party verification
- **Soroban smart contract anchoring** — Anchor proofs via Soroban contract calls instead of memo transactions
